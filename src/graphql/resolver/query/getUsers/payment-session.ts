import {
    WebUtils, UserDataStorage, getUserPrimaryKey, UserPrimaryStorage
} from '@mytaptrack/lib';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { MttAppSyncContext } from '@mytaptrack/cdk';
import { Dal, DalKey, MttIndexes } from '@mytaptrack/lib/dist/v2/dals/dal';
import { Stripe } from 'stripe';

let endpointSecret: string;
let stripe: Stripe;

const secretsManager = new SecretsManagerClient({});
const data = new Dal('data');
const primary = new Dal('primary');

interface QueryParams {
    license: string;
}

interface ResultModel {
    license: string;
    clientSecret: string;
}

export const handler = WebUtils.graphQLWrapper(eventHandler);

export async function eventHandler(context: MttAppSyncContext<QueryParams, any, any, {}>): Promise<ResultModel> {
    console.log(context.arguments);
    const license = context.arguments.license;
    const group = context.identity.groups.find(x => x.indexOf(context.arguments.license) >= 0);
    if(!group) {
        return;
    }
    if(!stripe) {
        const secretResult = await secretsManager.send(new GetSecretValueCommand({
            SecretId: process.env.stripeSecret
        }));

        endpointSecret = JSON.parse(secretResult.SecretString!).secret;

        stripe = new Stripe(endpointSecret);
    }
}
