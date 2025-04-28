import { StudentConfigStorage, WebUtils, moment } from "@mytaptrack/lib";
import { getNoteStorageKey } from "../graphql/resolver/types";
import { Dal } from "@mytaptrack/lib/dist/v2/dals/dal";
import { ListObjectsV2CommandOutput, S3 } from "@aws-sdk/client-s3";
import { getStudentPrimaryKey } from '@mytaptrack/lib/dist/v2/utils/index';
import { NoteStorage } from "../graphql/resolver/mutations/report/notes";

const data = new Dal('data');
const primary = new Dal('primary');

const s3 = new S3({});
const keyMatch = /student\/[a-z0-9A-Z\-]+\/notes\/[0-9]+\/[0-9]+\/[0-9]+\.json/

export const onCreate = WebUtils.lambdaWrapper(onCreateHandler);

export async function onCreateHandler(event) {
    console.log('Event: ', event);

    let token: any;
    do {
        console.info('Getting records');
        let notes = await s3.listObjectsV2({
            Bucket: process.env.dataBucket,
            Prefix: "student/",
            StartAfter: token
        });
        token = undefined;

        if(notes.Contents) {
            token = notes.Contents[(notes.Contents?.length ?? 1) - 1]?.Key;

            await Promise.all(notes.Contents.map(async c => {
                if(!c.Key.match(keyMatch)) {
                    return;
                }

                const keyParts = c.Key.split("/");
                const studentId = keyParts[1];
                const year = keyParts[3];
                const month = keyParts[4];
                const day = keyParts[5].split('.')[0];
                const noteDate = moment(`${year}-${month}-${day}`);
                const noteType = "NB";

                const student = await data.get<StudentConfigStorage>(getStudentPrimaryKey(studentId), "license");
                if(!student) {
                    console.log(`Student ${studentId} not found`);
                    return;
                }

                console.log(`Processing ${c.Key}`);
                const s3Object = await s3.getObject({
                    Bucket: process.env.dataBucket,
                    Key: c.Key!
                });

                const content = await s3Object.Body.transformToString();

                if(!content) {
                    console.log(`Content not found for ${c.Key}`);
                    return;
                }

                const s3NoteData = JSON.parse(content);

                const key = getNoteStorageKey(studentId, noteType, noteDate.toDate().getTime(), noteDate.toISOString());

                console.log(`Putting ${key.pk}, ${key.sk}`);
                // console.log('Content', content);
                try {
                    await primary.put({
                        ...key,
                        pksk: `${key.pk}#${key.sk}`,
                        lpk: student.license,
                        lsk: `S#${student.studentId}#${noteType}#${noteDate.toDate().getTime()}`,
                        studentId,
                        noteDate: noteDate.toDate().getTime(),
                        dateEpoc: moment(s3NoteData.lastUpdate).toDate().getTime(),
                        note: s3NoteData.notes,
                        noteId: noteDate.toISOString(),
                        product: 'behavior',
                        source: {
                            type: 'unknown',
                            id: '',
                            name: ''
                        }
                    } as NoteStorage);
                    console.log(`Note stored ${key.pk}, ${key.sk}`);
                } catch (err) {
                    console.log(`Note failed to save ${key.pk} , ${key.sk}, ${err}`);
                }
            }));
            console.log(`Last query token: ${token}`);
        }

    } while (token);

    return { physicalResourceId: 'migrate-notes-complete' };
}
