import { Dal } from "@mytaptrack/lib/dist/v2/dals/dal";
import { ActivityGroupEx, getStudentSchedulePrimaryKey, moment, ScheduleDal, SchedulePiiStorage, ScheduleStorage } from '@mytaptrack/lib';
import { ActivityGroupDetails, QLStudentUpdateInput } from "@mytaptrack/types";
import shortUUID from "short-uuid";

const primary = new Dal('primary');
const data = new Dal('data');

function constructPiiName(name: string, names: { name: string, id: string}[]) {
    let item = names.find(x => x.name == name);
    if(!item) {
        item = {
            name,
            id: shortUUID().toString()
        };
        names.push(item);
    }
    return item.id;
}

function constructPiiNames(schedule: ActivityGroupDetails, names: { name: string, id: string}[]) {
    schedule.activities.forEach(x => {
        x.title = constructPiiName(x.title, names);
    });
}

export async function processSchedules(student: QLStudentUpdateInput) {
    console.info('Getting existing schedules');
    const schedules = await ScheduleDal.getSchedules(student.studentId!, 0);
    const input = student.scheduleCategories!;

    console.info('Processing schedule deletes');
    const deletePromises = Promise.all(schedules?.filter(x => !input.find(y => y.name == x.name && y.schedules.length > 0))
        .map(async s => {
            const key = getStudentSchedulePrimaryKey(student.studentId, s.name);
            await Promise.all([
                data.delete(key),
                primary.delete(key)
            ]);
        }) ?? []);

    console.info('Processing schedule updates');
    const updatePromises = Promise.all(input
        .map(async s => {
            const scheduleKey = getStudentSchedulePrimaryKey(student.studentId!, s.name);
            const existingPii = await primary.get<SchedulePiiStorage>(scheduleKey);
            const names: { name: string, id: string}[] = existingPii?.names ?? [];
            for(let version of s.schedules) {
                constructPiiNames(version, names);
            }

            console.log('Processing existing schedule', s.name);

            const schedules = s.schedules.map(v => ({
                ...v,
                time: moment(v.startDate!).toDate().getTime()
            } as ActivityGroupEx));
            schedules.sort((a, b) => a.time - b.time);

            await Promise.all([
                data.put<ScheduleStorage>({
                    ...scheduleKey,
                    pksk: `${scheduleKey.pk}#${scheduleKey.sk}`,
                    studentId: student.studentId!,
                    tsk: scheduleKey.sk,
                    license: student.license,
                    schedules,
                    latest: schedules[schedules.length - 1],
                    version: 1
                }),
                primary.put<SchedulePiiStorage>({
                    ...scheduleKey,
                    pksk: `${scheduleKey.pk}#${scheduleKey.sk}`,
                    studentId: student.studentId!,
                    tsk: scheduleKey.sk,
                    license: student.license,
                    names,
                    version: 1
                })
            ])
        }));

    await Promise.all([updatePromises, deletePromises]);
}
