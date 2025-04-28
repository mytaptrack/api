import { util, extensions } from '@aws-appsync/utils';

export function request(ctx) {
    if(ctx.args.userId != ctx.identity.username) {
        return util.unauthorized();
    }
    return { payload: null }
}

export function response(ctx) {
    return null;
}
