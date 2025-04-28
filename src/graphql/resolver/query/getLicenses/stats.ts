import {
    WebUtils, StudentDal, StudentConfigStorage, LicenseDal
} from '@mytaptrack/lib';
import {
    LicenseStats,
    ManageStatRow,
    QLLicenseStats,
} from '@mytaptrack/types';
import { MttAppSyncContext } from '@mytaptrack/cdk';
import { TimestreamQuery } from '@aws-sdk/client-timestream-query';
import { Dal, MttIndexes } from '@mytaptrack/lib/dist/v2/dals/dal';
import { filter } from 'rxjs';

const timestream = new TimestreamQuery();
const dataDal = new Dal('data');

interface QueryParams {
    license: string;
}

export const handler = WebUtils.graphQLWrapper(eventHandler);

export async function eventHandler(context: MttAppSyncContext<QueryParams, any, any, {}>): Promise<QLLicenseStats> {
    console.log('Getting license');
    const [license, students, tsresults] = await Promise.all([
        LicenseDal.get(context.arguments.license),
        dataDal.query<StudentConfigStorage>({
            keyExpression: 'lpk = :lpk and begins_with(lsk, :lsk)',
            attributeValues: {
                ':lpk': `${context.arguments.license}#S`,
                ':lsk': 'P#'
            },
            indexName: MttIndexes.license,
            projectionExpression: 'licenseDetails'
        }),
        timestream.query({
            QueryString: `
            SELECT
                BIN(otime, 1d) AS binned_timestamp,
                count(distinct studentId)
            FROM (select bin(otime, 1d) as otime from UNNEST(sequence(ago(7d), now(), 1d)) as a (otime))
            left join (
                select * from "${process.env.timestreamDatabase}"."data"
                Where licenseType = 'flexible'
                and license = '${context.arguments.license}'
                and time > ago(7d)
            ) on BIN(time, 1d) = otime
            group by BIN(otime, 1d)
            order by BIN(otime, 1d)
            `
        })
    ]);

    const single = students.filter(x => x.licenseDetails.fullYear).length;
    const serviceUsed = students.filter(x => x.licenseDetails.services).length;

    return {
        license: {
            serviceSampleStudents: false,
            license: license.license,
            customer: license.customer,
            singleCount: license.singleCount,
            singleUsed: single,
            multiCount: license.multiCount,
            serviceCount: license.serviceCount ?? 0,
            serviceUsed: serviceUsed ?? 0,
            admins: license.admins,
            emailDomain: license.emailDomain,
            expiration: license.expiration,
            mobileTemplates: license.mobileTemplates ?? [],
            studentTemplates: (license.studentTemplates as any) ?? [],
            features: {
                ...license.features,
                abc: license.features.abc!,
                notifications: license.features.notifications!,
                appGroups: license.features.appGroups!,
                documents: license.features.documents!,
                intervalWBaseline: license.features.intervalWBaseline!
            },
            abcCollections: license.abcCollections ?? [],
            tags: license.tags ?? { devices: [] }
        },
        stats: {
            single,
            flexible: tsresults.Rows.map(r => ({ 
                date: r.Data[0].ScalarValue, 
                count: Number.parseInt(r.Data[1].ScalarValue!)
            } as ManageStatRow))    
        }
    };
}
