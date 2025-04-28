import { WebUserDetails, WebUtils, v2, WebError, moment } from '@mytaptrack/lib';
import { typesV2 } from '@mytaptrack/types';
import { TimestreamQuery } from '@aws-sdk/client-timestream-query';

const timestream = new TimestreamQuery();

export const handleEvent = WebUtils.apiWrapperEx<typesV2.ManagedReportOverTimePostRequest>(handler, {
  schema: typesV2.ManagedReportOverTimePostRequestSchema
});
const dataVersion = 5;

export async function handler(request: typesV2.ManagedReportOverTimePostRequest, userDetails: WebUserDetails) {
  if (!userDetails.licenses || !userDetails.licenses?.length || !userDetails.licenses.find(x => x == request.license)) {
    console.log('No user or license found');
    throw new WebError('Access Denied');
  }
  console.log('Request');
  console.log(JSON.stringify(request));

  const behaviorIds: string[] = request.behaviorNames ? await Promise.all(request.behaviorNames.filter(x => x? true : false).map(async x => (await v2.LookupDal.getBehavior(request.license, x)).shortId)) : [];

  const behaviorIdString = behaviorIds.map(x => `'${x}'`).join(',');
  const dateString = moment(request.startDate).tz('America/Los_Angeles').toISOString();
  const endString = moment(request.endDate).tz('America/Los_Angeles').add(1, 'day').toISOString();
  const eventsTable = `"${process.env.timestreamDatabase}"."data"`;
  const QueryString = `
select studentId, date_trunc('week', time) as date, sum(measure_value::bigint) as count
from ${eventsTable}
where time > from_iso8601_timestamp('${dateString}')
and time <= from_iso8601_timestamp('${endString}')
and behaviorId in (${behaviorIdString})
group by studentId, date_trunc('week', time)
order by date_trunc('week', time)`.slice(1);

  console.log('Query', QueryString);

  const queryResults = await timestream.query({
    QueryString
  });

  WebUtils.logObjectDetails(queryResults.Rows);
  const raw = queryResults.Rows.map(row => ({ studentId: row.Data[0].ScalarValue, date: new Date(row.Data[1].ScalarValue!).toISOString(), count: Number.parseInt(row.Data[2].ScalarValue!) }));
  const retval: typesV2.ManageReportPostResponse<typesV2.ManageReportDateDataPoint> = {
    summary: [],
    students: []
  };

  console.log('Constructing results');
  raw.forEach(x => {
    const line = retval.summary.find(y => y.date == x.date);
    if (!line) {
      retval.summary.push({ date: x.date, count: x.count });
    } else {
      line.count += x.count;
    }
    const behavior = retval.students.find(y => y.studentId == x.studentId);
    if (!behavior) {
      retval.students.push({ studentId: x.studentId!, data: [{ date: x.date, count: x.count }] });
    } else {
      behavior.data.push({ date: x.date, count: x?.count });
    }
  });

  console.log('Getting start date and end date');
  let pot = moment(retval.summary[0]?.date);
  const endDate = moment(request.endDate);
  console.log('Fixing dates');
  while (pot.isSameOrBefore(endDate)) {
    const data = retval.summary.find(x => x.date == pot.toISOString());
    if (!data) {
      retval.summary.push({
        date: pot.toISOString(),
        count: 0
      });
    }
    pot = pot.add(7, 'days');
  }
  console.log('Returning results');
  return retval;
}
