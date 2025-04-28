import { type AppSyncResolverEvent, type AppSyncIdentityCognito, type AppSyncIdentity, type AppSyncResolverEventHeaders } from 'aws-lambda';

export interface AppSyncResults<TArguments, TResultType, TSource = Record<string, any> | null> {
    arguments: TArguments;
    identity?: AppSyncIdentity;
    source: TSource;
    request: {
        headers: AppSyncResolverEventHeaders;
        /** The API's custom domain if used for the request. */
        domainName: string | null;
    };
    info: {
        selectionSetList: string[];
        selectionSetGraphQL: string;
        parentTypeName: string;
        fieldName: string;
        variables: { [key: string]: any };
    };
    prev: { result: { [key: string]: any } } | null;
    stash: { [key: string]: any };
    result: TResultType
}

export * from './app-storage';
export * from './track-storage';
