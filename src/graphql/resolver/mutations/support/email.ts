import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { MttAppSyncContext } from "@mytaptrack/cdk";
import { UserPrimaryStorage, WebUtils, getUserPrimaryKey } from "@mytaptrack/lib";
import { Dal } from "@mytaptrack/lib/dist/v2/dals/dal";
import { QLEmailSupport } from "@mytaptrack/types";

export const handler = WebUtils.graphQLWrapper(eventHandler);

const primary = new Dal('primary');
const ses = new SESClient({});

async function eventHandler(context: MttAppSyncContext<{ input: QLEmailSupport }, never, never, {}>): Promise<boolean> {
    const { url, problem } = context.arguments.input;
    const userId = context.identity.username;
    const user = await primary.get<UserPrimaryStorage>(getUserPrimaryKey(userId));
    if(!user) {
        throw new Error('No user exists');
    }

    await ses.send(new SendEmailCommand({
        Source: process.env.SystemEmail,
        Destination: {
            ToAddresses: ['support@mytaptrack.com']
        },
        ReplyToAddresses: [user.details.email],
        Message: {
            Subject: {
                Data: 'Support Needed'
            },
            Body: {
                Text: {
                    Data: `
                    URL: ${url}

                    Problem:
                    ${problem}
                    `
                }
            }
        }
    }));
    return true;
}