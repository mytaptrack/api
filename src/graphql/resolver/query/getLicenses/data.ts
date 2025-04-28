import { util } from '@aws-appsync/utils'
import { BatchGetItemCommand, BatchGetItemCommandInput } from '@aws-sdk/client-dynamodb';
import { BatchGetItemResponse, MttAppSyncContext, BatchGetItemResults } from '@mytaptrack/cdk';
import { WebUtils, type LicenseStorage, getLicenseKey } from '@mytaptrack/lib';
import { Dal } from '@mytaptrack/lib/dist/v2/dals/dal';
import { type LicenseDetails } from '@mytaptrack/types';

const data = new Dal('data');

export const handler = WebUtils.graphQLWrapper(eventHandler);

export async function eventHandler(context: MttAppSyncContext<{ licenses: string[] } , any, any, {}>): Promise<LicenseDetails[]> {
    let licenses: string[] = context.identity?.groups?.filter(g => g.startsWith("licenses/")) ?? [];

    console.log('Getting # licenses:', licenses.length);
    
    if(context.identity.groups?.find(g => g == 'admins') && context.arguments?.licenses && context.arguments?.licenses.length > 0) {
        console.log('Overriding license list');
        licenses = context.arguments.licenses;
    }

    const licenseList = licenses
        .map(g => g.replace("licenses/", ""))

    const batchGetCommand: BatchGetItemCommandInput = {
        RequestItems: {}
    };

    let items: LicenseStorage[] = [];
    
    if(licenseList.length > 0) {
        items = await data.batchGet<LicenseStorage>(licenseList.map(l => getLicenseKey(l)));
    }

    if(items.length == 0) {
        return [];
    }

    console.log('Resulting items:', items.length);
    return items.filter(item => item && item.details).map(item => {
        let singleUsed: number | string[] = item.details.singleUsed;
        if((singleUsed as any).length != undefined) {
            singleUsed = (singleUsed as any).length;
        }
        if(!singleUsed) {
            singleUsed = 0;
        }

        if(item.details.features && item.details.features.duration == undefined) {
            item.details.features.duration = true;
        }
        if(typeof item.details.features.intensity == 'boolean') {
            delete item.details.features.intensity;
        }

        return {
            license: item.license,
            customer: item.details.customer,
            singleCount: item.details.singleCount,
            singleUsed,
            multiCount: item.details.multiCount,
            appLimit: item.details.appLimit,
            admins: item.details.admins,
            emailDomain: item.details.emailDomain,
            expiration: item.details.expiration,
            mobileTemplates: item.details.mobileTemplates ?? [],
            studentTemplates: item.details.studentTemplates ?? [],
            features: item.details.features,
            abcCollections: item.details.abcCollections ?? [],
            tags: item.details.tags ?? {}
        } as LicenseDetails;
    });
}
