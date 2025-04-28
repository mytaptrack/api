import { util } from '@aws-appsync/utils'
import { 
    UserStudentTeam, 
    AppSyncResults
} from '@mytaptrack/lib';
import {
    StudentService,
    Student
} from '@mytaptrack/types';

interface AppSyncParams {
  studentId: string;
  service: StudentService
}

/**
 * Request a single item with `id` from the attached DynamoDB table datasource
 * @param event the context object holds contextual information about the function invocation.
 */
export function request(event: AppSyncResults<AppSyncParams, Student, null>) {
    console.log('updateService data.request', event);
    const studentId = event.arguments.studentId;
    const student: Student = event.stash.student as any;
    const serviceCopy: StudentService = {
        ...event.arguments.service
    };
    delete (serviceCopy as any).measurementUnit;
    delete (serviceCopy as any).durationRounding;
    delete (serviceCopy as any).target;
    delete (serviceCopy as any).detailedTargets;

    if(!student.services) {
        return { 
            operation: 'UpdateItem',
            key: util.dynamodb.toMapValues({ 
                pk: `S#${studentId}`, 
                sk: `P` 
            }),
            update: {
                expression: `SET services = :service`,
                expressionValues: util.dynamodb.toMapValues({
                    ':service': [serviceCopy]
                })
            }
        };
    }
    const existingIndex = student.services.findIndex(service => service.id == event.arguments.service.id);
    if(existingIndex > -1) {
        return {
            operation: 'UpdateItem',
            key: util.dynamodb.toMapValues({ 
                pk: `S#${studentId}`, 
                sk: `P` 
            }),
            update: {
                expression: `SET services[${existingIndex}] = :service`,
                expressionValues: {
                    ':service': util.dynamodb.toMapValues(serviceCopy)
                }
            }
        };
    } else {
        return { 
            operation: 'UpdateItem',
            key: util.dynamodb.toMapValues({ 
                pk: `S#${studentId}`, 
                sk: `P` 
            }),
            update: {
                expression: `SET services = list_append(services, :service)`,
                expressionValues: {
                    ':service': util.dynamodb.toMapValues(serviceCopy)
                }
            }
        };
    }
}

/**
 * Returns the result directly
 * @param event the context object holds contextual information about the function invocation.
 */
export function response(event: AppSyncResults<AppSyncParams, UserStudentTeam, null>) {
    console.log('updateService data.response');
  return event.arguments.service;
}
