import { util, extensions } from '@aws-appsync/utils';

export function request(ctx) {
    return { payload: ctx.arguments.input };
}

export function response(ctx) {
    console.log('ctx', ctx);
    return ctx.result;
}
