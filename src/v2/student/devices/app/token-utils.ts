import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { AES, enc } from 'crypto-ts';

const ssm = new SSMClient({});

let cachedTokenKey = '';
let cachedTokenDetails = '';
const TokenPrefix = 'MTESQ';

export interface TokenSegments {
    id: string;
    auth: string;
    noGen?: boolean;
}

export async function getTokenKey() {
    if (!cachedTokenKey) {
        const result = await ssm.send(new GetParameterCommand({
            Name: process.env.TokenEncryptKey,
            WithDecryption: true
        }));

        cachedTokenKey = result.Parameter.Value;
    }
    return cachedTokenKey;
}

export function getTokenSegments(token: string, tokenKey: string): TokenSegments {
    const decryptedToken = AES.decrypt(token, tokenKey).toString(enc.Utf8);
    console.log('Decrypted', token, decryptedToken);
    if (!decryptedToken.startsWith(TokenPrefix)) {
        console.log('Invalid token retrieved', decryptedToken);
        throw new Error('Invalid Token');
    }

    const peices = decryptedToken.slice(5);
    const index = peices.indexOf('|');
    if (index < 0) {
        console.log('Invalid token prefix check', decryptedToken);
    }
    return {
        id: peices.slice(index + 1),
        auth: peices.slice(0, index)
    } as TokenSegments;
}

export function generateToken(identifier: string, auth: string, tokenKey: string) {
    const combined = `${TokenPrefix}${auth}|${identifier}`;
    return AES.encrypt(combined, tokenKey).toString();
}
