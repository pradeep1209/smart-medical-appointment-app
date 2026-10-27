import { Body, Controller, Get, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { AuthGuard, AuthRequest } from './auth.guard';
import { ExperienceService } from './experience.service';
import { ClinicItemParams, ClinicProfileDto, DoctorProfessionalDto, DoseDto, ExperienceQuery, ExportDto, ItemParams, MedicationPlanDto, PatientProfileDto, ReplaceDto, RevokeDto, ShareDocumentDto, SummaryDto, UploadDocumentDto, VerifyParams } from './experience.dto';
import { escapeHtml } from './experience-policy';
@Controller('experience') @UseGuards(AuthGuard)
export class ExperienceController {
 constructor(private readonly service:ExperienceService){}
 @Get() bundle(@Req()r:AuthRequest,@Query()q:ExperienceQuery){return this.service.bundle(r.actor,q.clinicId);}
 @Get('medication-plans') plans(@Req()r:AuthRequest){return this.service.medicationPlans(r.actor);}
 @Get('visits/:id') visit(@Req()r:AuthRequest,@Param()p:ItemParams){return this.service.visitRecord(r.actor,p.id);}
 @Get('prescriptions/:id') prescription(@Req()r:AuthRequest,@Param()p:ItemParams){return this.service.prescriptionRecord(r.actor,p.id);}
 @Post('profiles/clinic/:clinicId') clinic(@Req()r:AuthRequest,@Param()p:ClinicItemParams,@Body()d:ClinicProfileDto){return this.service.clinicProfile(r.actor,p.clinicId,d);}
 @Post('profiles/doctor') doctor(@Req()r:AuthRequest,@Body()d:DoctorProfessionalDto){return this.service.doctorProfile(r.actor,d);}
 @Post('profiles/patient') patient(@Req()r:AuthRequest,@Body()d:PatientProfileDto){return this.service.patientProfile(r.actor,d);}
 @Post('summaries/:id') summary(@Req()r:AuthRequest,@Param()p:ItemParams,@Body()d:SummaryDto){return this.service.summary(r.actor,p.id,d);}
 @Post('prescriptions/:id/replace') replace(@Req()r:AuthRequest,@Param()p:ItemParams,@Body()d:ReplaceDto){return this.service.replace(r.actor,p.id,d);}
 @Post('prescriptions/:id/revoke') revoke(@Req()r:AuthRequest,@Param()p:ItemParams,@Body()d:RevokeDto){return this.service.revoke(r.actor,p.id,d.reason);}
 @Post('documents') upload(@Req()r:AuthRequest,@Body()d:UploadDocumentDto){return this.service.upload(r.actor,d);}
 @Post('documents/:id/share') share(@Req()r:AuthRequest,@Param()p:ItemParams,@Body()d:ShareDocumentDto){return this.service.share(r.actor,p.id,d.appointmentId);}
 @Post('documents/:id/delete') remove(@Req()r:AuthRequest,@Param()p:ItemParams){return this.service.deleteDocument(r.actor,p.id);}
 @Post('document-grants/:id/revoke') unshare(@Req()r:AuthRequest,@Param()p:ItemParams){return this.service.revokeShare(r.actor,p.id);}
 @Post('notices/read-all') allRead(@Req()r:AuthRequest){return this.service.readNotice(r.actor);}
 @Post('notices/:id/read') read(@Req()r:AuthRequest,@Param()p:ItemParams){return this.service.readNotice(r.actor,p.id);}
 @Post('medication-plans') plan(@Req()r:AuthRequest,@Body()d:MedicationPlanDto){return this.service.plan(r.actor,d);}
 @Post('medication-plans/:id/log') dose(@Req()r:AuthRequest,@Param()p:ItemParams,@Body()d:DoseDto){return this.service.dose(r.actor,p.id,d);}
 @Post('exports') export(@Req()r:AuthRequest,@Body()d:ExportDto){return this.service.export(r.actor,d);}
 @Post('prescriptions/:id/verification') verification(@Req()r:AuthRequest,@Param()p:ItemParams){return this.service.verificationLink(r.actor,p.id);}
}
@Controller('verify/prescriptions')
export class VerificationController {
 constructor(private readonly service:ExperienceService){}
 @Get(':token') async verify(@Param()p:VerifyParams,@Res()res:Response){const r=await this.service.verify(p.token);res.setHeader('X-Robots-Tag','noindex, nofollow');res.setHeader('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'");res.type('html').send(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CareSlot prescription verification</title><style>body{font:16px system-ui;background:#f5f9f6;color:#193f35;margin:0;padding:40px 24px}main{max-width:640px;margin:auto;background:white;padding:32px;border:1px solid #dce6df;border-radius:16px}h1{font-size:26px}dt{color:#586e63;margin-top:20px}dd{margin:4px 0;overflow-wrap:anywhere}p{line-height:1.6}</style><main><strong>CareSlot</strong><h1>Prescription verification</h1><dl><dt>Reference</dt><dd>${escapeHtml(r.number)}</dd><dt>Current status</dt><dd>${escapeHtml(r.status)}</dd><dt>Issued by</dt><dd>${escapeHtml(r.doctor)}</dd><dt>Clinic</dt><dd>${escapeHtml(r.clinic)}</dd><dt>Registration details supplied by clinic</dt><dd>${escapeHtml(r.registrationNumber||'Not provided')}</dd><dt>Issued</dt><dd>${escapeHtml(r.issuedAt.toISOString())}</dd>${r.replacement?`<dt>Replacement reference</dt><dd>${escapeHtml(r.replacement)}</dd>`:''}</dl><p>This verifies the stored issuer, reference and current status. Patient identity and medication details are private. It does not certify a professional registration or a cryptographic signature.</p></main></html>`);}
}
