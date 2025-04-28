import { v2, WebError, WebUserDetails, WebUtils } from '@mytaptrack/lib';
import { typesV2 } from '@mytaptrack/types';
import { Schema } from 'jsonschema';
import { TimestreamQueryClient, QueryCommand } from '@aws-sdk/client-timestream-query';

const timestream = new TimestreamQueryClient({});

interface QueryParams {
    license: string;
}
const QueryParamsSchema: Schema = {
    type: 'object',
    properties: {
        license: { type: 'string', required: true }
    }
}

export const handleEvent = WebUtils.apiWrapperEx(post, {
    processBody: 'Parameters',
    schema: QueryParamsSchema,
});

export async function post(request: QueryParams, user: WebUserDetails) {
    if(!user.licenses || !user.licenses.find(x => x === request.license)) {
        throw new WebError('License not found');
    }
    console.log('Getting license');
    const [students, tsresults] = await Promise.all([
        v2.StudentDal.getStudentDedicatedCountByLicense(request.license),
        timestream.send(new QueryCommand({
            QueryString: `
            SELECT
                BIN(otime, 1d) AS binned_timestamp,
                count(distinct studentId)
            FROM (select bin(otime, 1d) as otime from UNNEST(sequence(ago(7d), now(), 1d)) as a (otime))
            left join (
                select * from "${process.env.timestreamDatabase}"."data"
                Where licenseType = 'flexible'
                and license = '${request.license}'
                and time > ago(7d)
            ) on BIN(time, 1d) = otime
            group by BIN(otime, 1d)
            order by BIN(otime, 1d)
            `
        }))
    ]);

    return {
        stats: {
            single: students,
            flexible: tsresults.Rows.map(r => ({ 
                date: r.Data[0].ScalarValue, 
                count: Number.parseInt(r.Data[1].ScalarValue!)
            } as typesV2.ManageStatRow))    
        }
    };
}
