import { REST, Routes } from 'discord.js';
import { env } from './settings.js';
import { commands } from './commands.js';
const rest = new REST({ version:'10' }).setToken(env.DISCORD_TOKEN);
// POST atualiza somente este comando, preservando outros comandos do aplicativo.
for (const command of commands) {
  await rest.post(Routes.applicationGuildCommands(env.CLIENT_ID, env.GUILD_ID), {body:command.toJSON()});
  console.log('Registrado: /'+command.name);
}
console.log(commands.length+' comandos registrados no servidor.');
