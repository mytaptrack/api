import { StudentDataType } from '@mytaptrack/lib';

import { ReportDetails, QLReportData, QLReportDetails, ReportServiceData, QLReportService } from '@mytaptrack/types';

export interface StudentReportStorage extends QLReportDetails, StudentDataType {
    data: ReportDataStorage[];
    services: ReportServiceDataStorage[];
}

export interface ReportServiceDataStorage extends QLReportService {
}
export interface ReportDataStorage extends QLReportData {
}
export interface DeviceReports {
    studentReport: ReportDetails;
    behaviorReport: ReportDetails;
}
