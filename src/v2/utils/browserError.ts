import { APIGatewayEvent } from 'aws-lambda';
import { WebUtils } from '@mytaptrack/lib';

export const handleEvent = WebUtils.lambdaWrapper(handler)

export async function handler(event: APIGatewayEvent) {
    console.log(event.body);
    const body = JSON.parse(event.body!) as any;
    if(body.message && body.message == "The incoming token has expired") {
        // Do nothing as this is a logged out issue
        console.log('Not sending error due to type of error');
    } else {
        WebUtils.setError(new Error(body.message));
    }

    return WebUtils.done(null, '200', { success: true }, event);
}
