import { clinicContext,serverApi } from '@/lib/server-api';
import { ExperienceWorkspace,type ExperienceData } from '@/components/experience-workspace';
export const metadata={title:'Notifications'};
export default async function NotificationsPage(){const {membership}=await clinicContext();const data=await serverApi<ExperienceData>(`/experience?clinicId=${membership.clinicId}`);return <><header className="page-heading"><div><h1>Notifications</h1><p>Appointment changes and tasks for your clinic role.</p></div></header><ExperienceWorkspace initial={data} notifications/></>;}
