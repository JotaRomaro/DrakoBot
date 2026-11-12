export function topicOf(ticket) {
  return 'ticket-v1:' + JSON.stringify(ticket);
}
export function parseTopic(topic) {
  if (!topic?.startsWith('ticket-v1:')) return null;
  try {
    const t = JSON.parse(topic.slice(10));
    if (!/^\d{17,20}$/.test(t.owner) || !['open','closed'].includes(t.status) || !['none','review','approved'].includes(t.payment)) return null;
    return t;
  } catch { return null; }
}
export function isStaff(member, supportRoleIds) {
  const ids = Array.isArray(supportRoleIds) ? supportRoleIds : [supportRoleIds];
  return member.permissions.has(8n) || ids.some(id => member.roles.cache.has(id));
}
export function assertCanCloseTicket(member) {
  if (!member.permissions.has(8n)) throw new Error('Apenas adm/staff podem finalizar o ticket');
}
export function claimTicket(ticket, actorId, staff) {
  if (!staff) throw new Error('Somente a equipe pode assumir o atendimento.');
  if (ticket.assignee) throw new Error(ticket.assignee === actorId ? 'Você já assumiu este atendimento.' : 'Este atendimento já foi assumido por <@'+ticket.assignee+'>.');
  return {...ticket,assignee:actorId};
}
export async function withLock(locks, key, work) {
  if (locks.has(key)) throw new Error('Já existe uma ação em andamento. Aguarde alguns segundos.');
  locks.add(key);
  try { return await work(); } finally { locks.delete(key); }
}
