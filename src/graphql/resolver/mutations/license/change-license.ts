import {
    WebUtils, WebError, LicenseDal, getLicenseKey
} from '@mytaptrack/lib';
import { MttAppSyncContext } from '@mytaptrack/cdk';
import { LicenseDetails, QLLicenseUpdate } from '@mytaptrack/types';
import { Stripe } from 'stripe';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { Dal, DalKey, MttIndexes } from '@mytaptrack/lib/dist/v2/dals/dal';
import { TransactWriteCommand, TransactWriteCommandInput } from '@aws-sdk/lib-dynamodb';

let stripe: Stripe;
let endpointSecret: string;
const secretsManager = new SecretsManagerClient({});

const data = new Dal('data');
const primary = new Dal('primary');

export interface AppSyncParams {
    input: QLLicenseUpdate;
}

export interface LicenseDetailsEx extends LicenseDetails {
    userId: string;
}

export const handler = WebUtils.graphQLWrapper(handleEvent);

export async function handleEvent(context: MttAppSyncContext<AppSyncParams, never, never, {}>): Promise<LicenseDetailsEx> {
    console.debug('Event', context);
    const params = context.arguments.input;
    const license = await LicenseDal.get(params.license);

    if(params.fullCancel) {
        const input: TransactWriteCommandInput = { TransactItems: [] };
        const datas = ([] as DalKey[]).concat(...await Promise.all([
            data.query<DalKey>({
                keyExpression: 'lpk = :license',
                attributeValues: {
                    ':license': `${params.license}#R`
                },
                projectionExpression: 'pk,sk',
                indexName: MttIndexes.license
            }),
            data.query<DalKey>({
                keyExpression: 'lpk = :license',
                attributeValues: {
                    ':license': `${params.license}#S`
                },
                projectionExpression: 'pk,sk',
                indexName: MttIndexes.license
            }),
            data.query<DalKey>({
                keyExpression: 'lpk = :license',
                attributeValues: {
                    ':license': `${params.license}#DA`
                },
                projectionExpression: 'pk,sk',
                indexName: MttIndexes.license
            }),
            data.query<DalKey>({
                keyExpression: 'lpk = :license',
                attributeValues: {
                    ':license': `${params.license}#T`
                },
                projectionExpression: 'pk,sk',
                indexName: MttIndexes.license
            }),
            data.query<DalKey>({
                keyExpression: 'lpk = :license',
                attributeValues: {
                    ':license': `L#${params.license}`
                },
                projectionExpression: 'pk,sk',
                indexName: MttIndexes.license
            })
        ]));
        const piis = ([] as DalKey[]).concat(...await Promise.all([
            primary.query<DalKey>({
                keyExpression: 'lpk = :license',
                attributeValues: {
                    ':license': `${params.license}#S`
                },
                projectionExpression: 'pk,sk',
                indexName: MttIndexes.license
            }),
            primary.query<DalKey>({
                keyExpression: 'lpk = :license',
                attributeValues: {
                    ':license': `${params.license}#AG`
                },
                projectionExpression: 'pk,sk',
                indexName: MttIndexes.license
            })
        ]));
        datas.forEach(key => {
            input.TransactItems.push({
                Delete: {
                    TableName: data.tableName,
                    Key: key
                }
            });
        });
        piis.forEach(key => {
            input.TransactItems.push({
                Delete: {
                    TableName: primary.tableName,
                    Key: key
                }
            });
        });
        input.TransactItems.push({
            Delete: {
                TableName: data.tableName,
                Key: { pk: 'L', sk: `P#${params.license}`}
            }
        });
        input.TransactItems.push({
            Update: {
                TableName: data.tableName,
                Key: { pk: `U#${context.identity.username}`, sk: 'P'},
                UpdateExpression: 'REMOVE license, licenseDetails'
            }
        });
        await cancelStripe(license);
        await data.send(new TransactWriteCommand(input))
    } else if(params.cancel) {
        console.log('Cancelling subscription');
        let stripeId = license.stripe?.id;

        if(license.singleUsed > 2) {
            console.log('Single used licenses too high to cancel');
            throw new WebError('There are too many active students, please remove all except 2');
        }

        if(stripeId) {
            await cancelStripe(license);
            
            console.info('Updating license in db');
            await data.update({
                key: getLicenseKey(params.license),
                updateExpression: 'SET #details.#features.#personal = :false, #details.#features.#free = :true, #details.#singleCount = :singleCount',
                attributeNames: {
                    '#details': 'details',
                    '#features': 'features',
                    '#personal': 'personal',
                    '#free': 'free',
                    '#singleCount': 'singleCount'
                },
                attributeValues: {
                    ':false': false,
                    ':true': true,
                    ':singleCount': 2
                }
            });
            license.features.personal = false;
            license.features.free = true;
            license.singleCount = 2;
        }
    }

    return {
        userId: context.identity.username,
        ...license
    };
}

async function cancelStripe(license: LicenseDetails) {
    let stripeId = license.stripe?.id;
    if(!stripe) {
        const secretResult = await secretsManager.send(new GetSecretValueCommand({
            SecretId: process.env.stripeSecret
        }));

        const secret = JSON.parse(secretResult.SecretString!);
        endpointSecret = secret.signing

        stripe = new Stripe(secret.secret);
    }
    if(license.stripe) {
        try {
            console.log('Cancelling stripe subscription')
            await stripe.subscriptions.cancel(stripeId);
            console.log('Stripe cancel succeeded');
        } catch (err) {
            console.error('An error occured', err);
            console.error('params', license);
            WebUtils.setError(err);
        }
    }
}
