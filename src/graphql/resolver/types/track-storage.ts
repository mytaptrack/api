import { DalKey } from "@mytaptrack/lib/dist/v2/dals/dal";

export interface LicenseTrack2PiiStorage extends DalKey {
    pksk: string;
    lpk: string;
    lsk: string;
    serialNumber: string;
    deviceName: string;
    studentIds: string[];
}
