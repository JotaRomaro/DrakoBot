import { topicOf } from './domain.js';
import { saveTranscript, recordEvent } from './history.js';

export async function closeTicket(channel, ticket, actorId, {save = saveTranscript, log = recordEvent} = {}) {
  let transcript, archiveReason;
  try { transcript = await save(channel,ticket,actorId); }
  catch (error) {
    console.error('Não foi possível exportar o ticket: '+(error.code || error.name));
    archiveReason = error instanceof Error && !('requestBody' in error) ? error.message : 'Falha na exportação da conversa.';
  }
  if (transcript) {
    await channel.delete('Ticket encerrado por '+actorId+'; conversa salva em TXT');
    await log('🔒 Ticket encerrado',channel,ticket,actorId,transcript.messageCount+' mensagens salvas em TXT. '+(transcript.delivered ? 'Arquivo enviado neste canal de logs.' : 'Arquivo salvo apenas na pasta local data/transcripts/.'));
    return {archived:false};
  }
  // Sem uma cópia completa, preserve o próprio canal para a equipe.
  await channel.permissionOverwrites.edit(ticket.owner,{ViewChannel:false,SendMessages:false});
  ticket.status='closed';
  await channel.setTopic(topicOf(ticket));
  await channel.setName('arquivado-'+channel.id.slice(-6)).catch(()=>{});
  await channel.send({content:'📁 Atendimento finalizado. Este canal foi preservado porque o TXT não pôde ser salvo.\n\n'+archiveReason,allowedMentions:{parse:[]}}).catch(()=>{});
  await log('📁 Ticket encerrado e arquivado',channel,ticket,actorId,'Conversa preservada neste canal. '+archiveReason);
  return {archived:true};
}
