// Deleting a procedure removes everything that belongs to it: applications
// with their uploads, appointments, then the procedure itself. Forms stay,
// other procedures may use them. The procedure goes last, so after a failure
// it is still listed and deleting again finishes the job.
import type { SharePointSite } from './site.ts';

export interface ProcedureDeletion {
    applications: number;
    appointments: number;
}

export async function deleteProcedure(site: SharePointSite, procedureId: string): Promise<ProcedureDeletion> {
    const filter = `fields/ProcedureId eq '${procedureId.replaceAll("'", "''")}'`;
    const [applications, appointments] = await Promise.all([
        site.listItems('applications', filter, ['ProcedureId']),
        site.listItems('appointments', filter, ['ProcedureId']),
    ]);
    if (applications.length) {
        // only existing folders: a missing one would show as a failed request in the browser
        const folders = new Set(await site.uploadFolders());
        for (const a of applications) if (folders.has(a.id)) await site.deleteUploads(a.id);
    }
    if (applications.length) await site.deleteItems('applications', applications.map((a) => a.id));
    if (appointments.length) await site.deleteItems('appointments', appointments.map((a) => a.id));
    await site.deleteItem('procedures', procedureId);
    return { applications: applications.length, appointments: appointments.length };
}
