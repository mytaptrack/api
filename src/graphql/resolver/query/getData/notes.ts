import { QLStudentNote } from '@mytaptrack/types';
import { MttAppSyncContext } from '@mytaptrack/cdk';
import { Moment, WebUtils, moment } from '@mytaptrack/lib';
import { Dal } from '@mytaptrack/lib/dist/v2/dals/dal';
import { NoteStorage } from '../../mutations/report/notes';

const primaryDal = new Dal('primary');

interface Params {
    studentId: string;
    product: 'behavior' | 'service';
    startDate: string;
    endDate: string;
}

interface StashData {
    start: number;
    end: number;
}

export function getNotesKey(studentId: string, date: Moment, product: string) {
    return `student/${studentId}/notes/${product ?? ''}${date.format('yyyy/MM/DD')}.json`;
}

export const handler = WebUtils.graphQLWrapper(handleEvent);

async function handleEvent(context: MttAppSyncContext<Params, never, never, StashData>): Promise<QLStudentNote[]> {
    const startDate: Moment = moment(context.arguments.startDate).startOf('day');
    const endDate: Moment = moment(context.arguments.endDate).endOf('day');
    const product = context.arguments.product;

    console.log('Start:', startDate.toDate().getTime(), ', end:', endDate.toDate().getTime(), ', product:', product);
    let productUrl = '';
    if(product == 'service') {
        productUrl = '/service';
    }

    let productId = 'NB';
    if(product == 'service') {
        productId = 'NS';
    }

    let startKey = `${startDate.toDate().getTime()}#N#00000000-0000-0000-0000-000000000000`
    let endKey = `${endDate.toDate().getTime()}#N#ffffffff-ffff-ffff-ffff-ffffffffffff`

    const notes = await primaryDal.query<NoteStorage>({
        keyExpression: 'pk = :pk and sk between :date and :endDate',
        filterExpression: 'attribute_not_exists(#deleted)',
        attributeNames: {
            '#deleted': 'deleted'
        },
        attributeValues: {
            ':pk': `S#${context.arguments.studentId}#${productId}`,
            ':date': startKey,
            ':endDate': endKey
        }
    });

    return notes.sort((a, b) => a.dateEpoc - b.dateEpoc).map(x => {
        return {
            studentId: context.arguments.studentId,
            product: product ?? 'behavior',
            noteDate: x.noteDate,
            noteId: x.noteId,
            dateEpoc: x.dateEpoc,
            date: x.date ?? '',
            source: x.source,
            note: x.note,
            threadId: x.threadId
        } as QLStudentNote;
    });
}
