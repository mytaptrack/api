import {
    AppPiiGlobal, DevicePiiGlobalStorage, Moment, StudentConfigStorage, UserPrimaryStorage,
    WebUtils, generateDeviceGlobalKey, getStudentPrimaryKey, getUserPrimaryKey, moment
} from '@mytaptrack/lib';
import { MttAppSyncContext } from '@mytaptrack/cdk';

import { Dal, DalKey } from '@mytaptrack/lib/dist/v2/dals/dal';
import { LicenseTrack2PiiStorage, getAppGlobalV2Key, getNoteStorageKey } from '../../types';
import { QLStudentNote, QLStudentNoteSource } from '@mytaptrack/types';
import shortUUID from 'short-uuid';

interface AppSyncParams {
    input: QLStudentNote;
}

const primaryDal = new Dal('primary');
const dataDal = new Dal('data');

export interface NoteStorage extends DalKey, QLStudentNote {
    lpk: string;
    lsk: string;
}

export const handler = WebUtils.graphQLWrapper(handleEvent);

export async function handleEvent(context: MttAppSyncContext<AppSyncParams, never, never, {}>): Promise<QLStudentNote> {
    const studentId = context.arguments.input.studentId;
    const notes = context.arguments.input.note;
    const input = context.arguments.input;

    let sourceId: string = input.source?.id;
    if(!sourceId || sourceId == '') {
        sourceId = context.identity.username;
        if(!input.source) {
            input.source = { id: sourceId, name: '', type: 'user' };
        } else {
            context.arguments.input.source.id = sourceId;
        }
    }

    const noteDate = moment(input.noteDate);
    input.noteDate = noteDate.startOf('day').toDate().getTime();

    if(!input.noteId) {
        input.noteId = shortUUID().uuid().toString()
    }
    if(!input.source) {
        input.source = {
            id: context.identity.username,
            name: '',
            type: 'user'
        }
    }

    console.log('Recovery Data', context.arguments);
    const student = await dataDal.get<StudentConfigStorage>(getStudentPrimaryKey(studentId), 'studentId, license, details');

    const isApp = context.identity['userArn']? true : false;
    await processNote(student, context.arguments.input, isApp? context.arguments.input.source.id : context.identity.username, isApp);

    return context.arguments.input;
}

async function processNote(student: StudentConfigStorage, input: QLStudentNote, userId: string, isApp: boolean) {
    const noteDate = moment(input.noteDate).startOf('day');
    const date = moment(input.dateEpoc);
    const product = input.product;
    const notes = input.note;

    if(!input.source.type) {
        input.source.type = 'user';
    }

    console.info('Processing note ', student.studentId, input.source.type, input.source.id, date, notes, product);
    let noteType: 'NB' | 'NS' = product == 'behavior' ? 'NB' : 'NS';
    const key = getNoteStorageKey(student.studentId, noteType, noteDate.toDate().getTime(), input.noteId);

    if(input.remove) {
        console.info("Deleting note: ", key.pk, ",", key.sk)
        await primaryDal.update({
            key,
            updateExpression: 'SET #deleted = :deleted',
            attributeNames: {
                '#deleted': 'deleted'
            },
            attributeValues: {
                ':deleted': {
                    id: userId.startsWith('arn'),
                    type: isApp? 'app' : 'user',
                    date: new Date().getTime()
                }
            }
        });
    } else {
        const previousNote = await primaryDal.get<NoteStorage>(key);
        if(previousNote) {
            if(previousNote.source.id != input.source.id) {
                throw new Error('Note source does not match');
            }
            input.source = previousNote.source;
        } else {
            switch(input.source.type) {
                case 'user':
                    const user = await primaryDal.get<UserPrimaryStorage>(getUserPrimaryKey(input.source.id));
                    input.source.name = user.details.name;
                    break;
                case 'track':
                    const track = await primaryDal.get<DevicePiiGlobalStorage>(generateDeviceGlobalKey(input.source.id))
                    input.source.name = track.name;
                    break;
                case 'app':
                    const app = await primaryDal.get<AppPiiGlobal>(getAppGlobalV2Key(student.license, input.source.id));
                    input.source.name = app.deviceName;
                    break;
                default:
                    break;
            }
        }

        // Single note match
        await primaryDal.put({
            ...key,
            pksk: `${key.pk}#${key.sk}`,
            lpk: student.license,
            lsk: `S#${student.studentId}#${noteType}#${noteDate.toDate().getTime()}`,
            ...input
        } as NoteStorage);
    }
}
