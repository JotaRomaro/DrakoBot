import { readFileSync } from 'node:fs';
export const config = JSON.parse(readFileSync(new URL('../config.json', import.meta.url), 'utf8'));
export const env = Object.fromEntries(['DISCORD_TOKEN','CLIENT_ID','GUILD_ID','SUPPORT_ROLE_ID','TICKET_CATEGORY_ID','VIP_ROLE_ID'].map(k=>[k, process.env[k]?.trim()]));
for (const [key,value] of Object.entries(env)) {
  if (!value) throw new Error('Preencha ' + key + ' no arquivo .env.');
  if (key !== 'DISCORD_TOKEN' && key !== 'SUPPORT_ROLE_ID' && !/^\d{17,20}$/.test(value)) throw new Error(key + ' precisa ser um ID válido do Discord.');
}
env.SUPPORT_ROLE_IDS = [...new Set(env.SUPPORT_ROLE_ID.split(',').map(id => id.trim()))];
if (env.SUPPORT_ROLE_IDS.some(id => !/^\d{17,20}$/.test(id))) throw new Error('SUPPORT_ROLE_ID precisa conter IDs válidos do Discord separados por vírgula.');
if (env.SUPPORT_ROLE_IDS.some(id => id === env.VIP_ROLE_ID || id === env.GUILD_ID) || env.VIP_ROLE_ID === env.GUILD_ID) throw new Error('Os cargos de equipe e VIP devem ser distintos e não podem ser @everyone.');
if (!Array.isArray(config.categories) || !config.categories.length || config.categories.length > 25) throw new Error('Configure entre 1 e 25 categorias.');
const ids = new Set();
for (const item of config.categories) {
  if (!/^[a-z0-9_-]{1,40}$/.test(item.id) || ids.has(item.id) || !item.label || item.label.length > 100 || !item.description || item.description.length > 100 || !item.message || item.message.length > 1800) throw new Error('Categoria inválida no config.json.');
  ids.add(item.id);
}
if (!config.panelTitle || config.panelTitle.length > 256 || !config.panelDescription || config.panelDescription.length > 4000) throw new Error('Revise o título e a descrição do painel.');
if (!config.vip || Object.values(config.vip).some(v => typeof v !== 'string' || v.length > 900)) throw new Error('Os campos de VIP devem ser textos de até 900 caracteres.');
if (Object.values(config.vip).reduce((total,v)=>total+v.length,0) > 3500) throw new Error('Reduza os textos de VIP para até 3500 caracteres no total.');
