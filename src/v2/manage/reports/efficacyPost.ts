import { WebUserDetails, WebUtils, v2, WebError, moment } from '@mytaptrack/lib';
import { typesV2 } from '@mytaptrack/types';
import { TimestreamQuery } from '@aws-sdk/client-timestream-query';

const timestream = new TimestreamQuery();

export const handleEvent = WebUtils.apiWrapperEx<typesV2.EfficacyPostRequest>(handler, {
  schema: typesV2.EfficacyPostRequestSchema
});
const dataVersion = 5;

export async function handler (request: typesV2.EfficacyPostRequest, userDetails: WebUserDetails) {
    console.log('Request');
    console.log(JSON.stringify(request));

    if(!userDetails.licenses || !userDetails.licenses?.length || !userDetails.licenses.find(x => x == request.license)) {
      throw new WebError('Access Denied');
    }

    const behaviorIds: string[] = request.behaviorNames? await Promise.all(
      request.behaviorNames.map(async x => (
          await v2.LookupDal.getBehavior(request.license, x
        )).shortId)
      ) : [];

    const behaviorIdString = behaviorIds.map(x => `'${x}'`).join(',');
    const dateString = moment(request.startDate).tz('America/Los_Angeles').toISOString();
    const weekMax = (request.weeksTracked - 1) * 7;
    const eventsTable = `"${process.env.timestreamDatabase}"."data"`;
    const QueryString = behaviorIds.length > 0? `
select studentId, distanceFromZero, count(0) as count
from (
  Select eventdata.studentId as studentId, eventdata.behaviorId as behaviorId, eventdata.license as license, date_trunc('week', eventdata.time) - date_trunc('week', start.beginning) as distanceFromZero
  from
  (
    SELECT studentId, behaviorId, license, min(bin(time, 1d)) as beginning, max(bin(time, 1d)) - min(bin(time, 1d)) as trackDuration
    from ${eventsTable}
    where version = '${dataVersion}'
    and license = '${request.license}'
    and behaviorId in (${behaviorIdString})
    and time > from_iso8601_timestamp('${dateString}')
    and measure_value::bigint <> 0
    group by studentId, behaviorId, license
  ) start
  join ${eventsTable} AS eventdata on start.behaviorId = eventdata.behaviorId and eventdata.version = '${dataVersion}'
  and trackDuration >= ${weekMax}d
  and date_trunc('week', eventdata.time) - date_trunc('week', beginning) >= 0d
  and date_trunc('week', beginning) + ${weekMax + 7}d > date_trunc('week', eventdata.time)
)
group by studentId, distanceFromZero
order by distanceFromZero`.slice(1) : `
select studentId, distanceFromZero, count(0) as count
from (
  Select eventdata.studentId as studentId, eventdata.behaviorId as behaviorId, eventdata.license as license, date_trunc('week', eventdata.time) - date_trunc('week', start.beginning) as distanceFromZero
  from
  (
    SELECT studentId, behaviorId, license, min(bin(time, 1d)) as beginning, max(bin(time, 1d)) - min(bin(time, 1d)) as trackDuration
    from ${eventsTable}
    where version = '5'
    and license = '${request.license}'
    and time > from_iso8601_timestamp('${dateString}')
    and measure_value <> 0
    group by studentId, behaviorId, license
  ) start
  join ${eventsTable} AS eventdata on start.behaviorId = eventdata.behaviorId and eventdata.version = '5'
  and trackDuration >= ${weekMax}d
  and date_trunc('week', eventdata.time) - date_trunc('week', beginning) >= 0d
  and date_trunc('week', beginning) + ${weekMax + 7}d > date_trunc('week', eventdata.time)
)
group by studentId, distanceFromZero
order by distanceFromZero`.slice(1);
    console.log('Query', QueryString);

    const queryResults = await timestream.query({
        QueryString
    });

    WebUtils.logObjectDetails(queryResults.Rows);
    const raw = queryResults.Rows.map(row => ({ studentId: row.Data[0].ScalarValue, offset: Number.parseInt(row.Data[1].ScalarValue!.split(' ')[0]) / 7, count: Number.parseInt(row.Data[2].ScalarValue!) }));
    const retval: typesV2.ManageReportPostResponse<typesV2.ManageReportOffsetDataPoint> = {
      summary: [],
      students: []
    };
    raw.forEach(x => { 
      const line = retval.summary.find(y => y.offset == x.offset);
      if(!line) {
        retval.summary.push({ offset: x.offset, count: x.count });
      } else {
        line.count += x.count;
      }
      const behavior = retval.students.find(y => y.studentId == x.studentId);
      if(!behavior) {
        retval.students.push({ studentId: x.studentId!, data: [{ offset: x.offset, count: x.count}]});
      } else {
        behavior.data.push({ offset: x.offset, count: x.count });
      }
    });

    return retval;
}
