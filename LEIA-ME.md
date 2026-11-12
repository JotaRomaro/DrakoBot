# Bot de tickets com Pix

O bot publica um painel com um menu de **Suporte** e **Compras · VIP**. O usuário escolhe o assunto no próprio painel e recebe um canal privado já preparado para esse atendimento. Canais de suporte começam com `suporte-`; os de compra, com `compras-`.

- Suporte: abre o atendimento com o texto de orientação configurado.
- Compras · VIP: abre o atendimento com benefícios, duração, valor, chave Pix e destinatário.
- Já paguei: aparece nos tickets de compras e envia o cartão de conferência e seus botões ao canal privado **logs-tickets**, visível para o cargo de atendimento e administradores, sem marcar ninguém. Apenas o titular pode usar. O cliente recebe somente “Envie o comprovante e aguarde!”. O botão fica desativado durante a conferência; se o pagamento não for localizado, uma nova tentativa é disponibilizada no ticket.
- Confirmar recebimento e liberar VIP: exclusivo da equipe e administradores, pelo cartão no canal privado; entrega o cargo VIP e informa a aprovação no ticket original. O cartão tem um link para o ticket e seu comprovante.
- Pagamento não localizado: reabre a solicitação para uma nova conferência.
- Assumir atendimento: exclusivo da equipe e administradores; registra o responsável no tópico, anuncia no ticket e remove o botão de assumir. Duas pessoas não podem assumir o mesmo ticket.
- Encerrar ticket: exclusivo de quem tem a permissão **Administrador**. A permissão é conferida ao clicar e novamente ao confirmar, usando os cargos atuais do membro. Salva a conversa em TXT e exclui o canal. Se não conseguir salvar, finaliza e arquiva o canal para preservar a conversa. O titular e atendentes sem Administrador não podem encerrar.
- Logs: registra pagamentos e encerramento em cartões no canal privado **logs-tickets**, com cópia dos eventos em `data/events.jsonl`. Abertura, escolha de assunto e atendimento assumido não geram avisos nesse canal. O responsável continua identificado no registro de encerramento e no TXT.

O Pix desta versão é **manual**: não consulta banco e não aprova comprovante automaticamente. Só confirme depois de conferir o crédito na conta. Com chave, nome, cidade e valor configurados, o ticket exibe um QR Code Pix escaneável e o código Pix Copia e Cola. A geração é local, sem serviços externos. A chave também continua disponível. O preço é o valor de um único plano configurado.

## 1. Criar o aplicativo

1. Instale Node.js 24.17 ou superior, com npm: https://nodejs.org/
2. Acesse https://discord.com/developers/applications e crie um aplicativo.
3. Em Bot, obtenha o token. Guarde apenas no arquivo .env local; não envie o token no chat.
4. Em OAuth2 / URL Generator, selecione os escopos bot e applications.commands. Marque: View Channels, Send Messages, Read Message History, Embed Links, Attach Files, Manage Channels e Manage Roles. Convide o bot para seu servidor.
5. Para salvar as conversas em TXT, ative **Message Content Intent** em **Bot → Privileged Gateway Intents** e salve. A leitura é feita pela API REST ao encerrar, sem exigir essa intent na conexão Gateway. Se estiver desativada, o bot continua funcionando e arquiva os tickets encerrados, preservando a conversa para a equipe.

## 2. Preparar o servidor

1. Crie um cargo exclusivo da equipe, por exemplo Atendimento, e atribua aos atendentes.
2. Crie um cargo VIP, com os benefícios desejados. Não dê a ele Administrador, Gerenciar cargos ou Gerenciar canais.
3. Mova o cargo do bot para cima do VIP na lista de cargos.
4. Crie uma categoria para os tickets. O bot precisa Ver canal, Gerenciar canais e Gerenciar permissões nessa categoria. Os tickets criados recebem permissões próprias e não herdam acesso de outros cargos da categoria.
5. Ative Configurações do Discord → Avançado → Modo desenvolvedor. Clique com o botão direito nos itens para copiar os IDs.

## 3. Configurar os arquivos

Abra um terminal nesta pasta e execute:

```powershell
Copy-Item .env.example .env
Copy-Item config.example.json config.json
npm install
```

Edite .env:

| Campo | O que colocar |
| --- | --- |
| DISCORD_TOKEN | Token do bot |
| CLIENT_ID | Application ID, na página General Information do aplicativo |
| GUILD_ID | ID do servidor |
| SUPPORT_ROLE_ID | IDs dos cargos da equipe separados por vírgula (também aceita um único ID) |
| TICKET_CATEGORY_ID | ID da categoria que receberá os tickets |
| VIP_ROLE_ID | ID do cargo entregue após a aprovação |

Para permitir vários cargos de suporte, use `SUPPORT_ROLE_ID=111111111111111111,222222222222222222` no `.env`. Quem tiver qualquer um desses cargos será reconhecido como equipe e terá acesso aos novos tickets e ao canal de logs. Reinicie o bot após alterar. Tickets já abertos mantêm as permissões anteriores; adicione os novos cargos nas permissões desses canais pelo Discord, se necessário.

Edite config.json para colocar seus textos e os dados verdadeiros do Pix. Exemplo do trecho vip:

```json
{
  "name": "VIP Ouro",
  "price": "R$ 29,90",
  "benefits": "Acesso aos canais VIP e benefícios descritos pela equipe. Validade: permanente.",
  "pixKey": "SUA_CHAVE_PIX",
  "receiverName": "NOME DO TITULAR DA CONTA",
  "receiverCity": "São Paulo",
  "instructions": "Confira o destinatário no banco. Após pagar, envie o comprovante e clique em Já paguei. Aguarde a conferência da equipe."
}
```

Esse exemplo substitui apenas o objeto vip, mantendo os demais campos do arquivo. Sem preço, chave e destinatário, o cliente solicita os dados à equipe. O botão Já paguei continua disponível para pagamentos combinados no atendimento. O campo price aceita valores como R$ 29,90, 29,90 ou 29.90. O valor configurado é incluído no QR Code, mas o bot não consulta o banco nem verifica o valor recebido. Sem receiverCity, o ticket mantém a chave Pix e os botões, sem gerar o QR Code. Confira nome, cidade e preço antes de colocar em uso.

## 4. Iniciar

```powershell
npm run register
npm start
```

No canal público de atendimento, um administrador executa **/painel**. O menu Suporte/Compras aparece no painel, antes de abrir o ticket. Os comandos são registrados somente no servidor configurado. Alterações de texto ou Pix exigem reiniciar o bot; publique um novo painel se mudar seu título, descrição ou visual. Mensagens já publicadas não mudam automaticamente. Painéis antigos com Abrir ticket continuam funcionando com a escolha dentro do canal até serem substituídos.

Mantenha o processo aberto para o bot funcionar. Ao fechar o terminal ou desligar o computador, ele fica offline. Para atendimento contínuo, execute em uma hospedagem que mantenha Node.js ativo. Use **uma única instância por servidor**.

## Conferência antes de usar com clientes

Use uma conta de teste sem cargo administrativo para escolher Suporte no painel e confirmar que outra conta comum não consegue ver o canal. Peça a um administrador para encerrar e escolha Compras · VIP em outro ticket. Confirme que Já paguei aparece somente em compras e apenas solicita revisão; uma conta comum não pode aprovar. Faça uma compra de teste e confira o crédito no banco antes de aprovar pela conta da equipe. Verifique a entrega do VIP e o encerramento.

Há testes locais de metadados, autorização, concorrência, exportação do TXT e preservação da conversa em caso de falha:

```powershell
node --test
```

## Comandos de moderação do servidor

Os comandos abaixo funcionam no servidor, fora do fluxo de tickets. As respostas ao executor são privadas. O anúncio é publicado apenas no canal escolhido, sem notificações por menção.

| Comando | Exemplo / uso | Permissão do executor |
| --- | --- | --- |
| `/ban` | `/ban membro:@Pessoa motivo:Spam` | Banir membros |
| `/unban` | `/unban id:ID_DO_USUARIO` | Banir membros |
| `/kick` | `/kick membro:@Pessoa motivo:Desrespeito` | Expulsar membros |
| `/timeout` | `/timeout membro:@Pessoa tempo:10m motivo:Spam` | Moderar membros |
| `/untimeout` | `/untimeout membro:@Pessoa` | Moderar membros |
| `/warn` | `/warn membro:@Pessoa motivo:Desrespeito` | Moderar membros |
| `/warnings` | `/warnings membro:@Pessoa` | Moderar membros |
| `/clearwarn` | `/clearwarn membro:@Pessoa motivo:Revisão` | Moderar membros |
| `/cleanup` | `/cleanup quantidade:20` | Gerenciar mensagens no canal |
| `/lock` | `/lock motivo:Manutenção` | Gerenciar canais e Gerenciar permissões no canal |
| `/unlock` | `/unlock` | Gerenciar canais e Gerenciar permissões no canal |
| `/slowmode` | `/slowmode segundos:10` (0 desativa) | Gerenciar canais no canal |
| `/nick` | `/nick membro:@Pessoa apelido:NovoNome` (sem apelido remove) | Gerenciar apelidos |
| `/cargo adicionar` | `/cargo adicionar membro:@Pessoa cargo:@Cargo` | Gerenciar cargos |
| `/cargo remover` | `/cargo remover membro:@Pessoa cargo:@Cargo` | Gerenciar cargos |
| `/anunciar` | `/anunciar canal:#avisos mensagem:Texto` | Gerenciar servidor e acesso de envio no destino |
| `/userinfo` | `/userinfo membro:@Pessoa` | Moderar membros |
| `/serverinfo` | `/serverinfo` | Moderar membros |

O `/anunciar` permite personalizar `titulo`, `mensagem` (conteúdo), `cor` (ex.: `#FF0000`), `imagem`, `miniatura`, `autor`, `icone_autor`, `rodape`, `icone_rodape`, `link` do título e `data` (sim/não). Os campos `canal`, `titulo` e `mensagem` são obrigatórios e aparecem juntos no comando; autor, rodapé e data ficam ocultos se não preenchidos. Imagens e ícones precisam de links HTTP/HTTPS. Para usar um ícone, preencha também o texto correspondente. Use `\n` no conteúdo para quebrar linhas. Exemplo: `/anunciar canal:#avisos mensagem:Confira as novidades! titulo:Atualização cor:#5865F2 rodape:Equipe data:true`.

O cargo de staff por si só não libera esses comandos: o membro precisa das permissões indicadas. O bot também precisa das permissões para executar a ação e de um cargo acima dos membros e cargos gerenciados. Não é necessário dar Administrador ao bot. As ações sobre membros respeitam a hierarquia do executor; um administrador também não pune membros de cargo igual ou superior ao próprio. O dono do servidor tem a exceção de hierarquia, mas o bot continua sujeito à hierarquia do Discord.

- Timeout aceita `s`, `m`, `h` e `d`, de 1 segundo até 28 dias. Não aplica castigo a administradores.
- Cleanup apaga de 1 a 100 mensagens elegíveis entre as 100 mais recentes; preserva fixadas e mensagens com 14 dias ou mais.
- Lock altera somente o envio de mensagens de @everyone. Cargos e membros com permissões explícitas podem continuar enviando. Unlock restaura a permissão anterior, em vez de conceder acesso novo. Use somente em canais de texto, assim como cleanup e slowmode.
- Advertências não aplicam punições automáticas. As consultas exibem as 8 mais recentes e o total. Os registros ficam em `data/moderation/` e sobrevivem a reinícios.
- As ações de moderação têm auditoria local em `data/moderation/events.jsonl`, com autor, alvo e motivo. Ações compatíveis também registram o motivo no log de auditoria do Discord. Elas não geram avisos no canal de logs de tickets.
- Ban não apaga mensagens anteriores. Use cleanup separadamente se precisar.
- Atualize o registro dos comandos com `npm run register` e reinicie o bot após mudar o código.

## Limites desta versão

- O canal **logs-tickets** é criado ou reutilizado na inicialização, com acesso apenas da equipe, bot e administradores. O bot precisa Gerenciar canais no servidor para criá-lo. O ID fica em `data/logs-channel.json`.
- Ao encerrar, o TXT fica em `data/transcripts/ID_DO_CANAL.txt` e é enviado ao canal de logs. Arquivos grandes são divididos em partes. Se o envio ao Discord falhar, a cópia local é mantida e o canal do ticket pode ser excluído normalmente.
- Se a leitura ou a gravação local falhar, o canal é renomeado para **arquivado-...**, fica oculto para o titular e continua disponível para a equipe. O usuário pode abrir outro ticket. Não apague esses canais sem guardar a conversa; eles continuam contando no limite de canais do Discord.
- O TXT contém as mensagens disponíveis no momento da exportação, com autores, horários, edições, embeds e links de anexos. Não recupera mensagens apagadas ou versões anteriores. Anexos não são baixados e seus links podem expirar.
- Faça backup de `data/`, que contém dados privados de atendimento. A pasta está ignorada pelo Git. Falhas nos logs de eventos são registradas no terminal e não bloqueiam ações do ticket.
- O botão Assumir atendimento desaparece após alguém assumir, inclusive ao escolher o assunto depois. O responsável persiste após reiniciar; os demais integrantes da equipe continuam podendo ajudar e revisar pagamentos.

- O cargo não expira automaticamente. Se o VIP tiver prazo, a equipe controla sua remoção. O texto de benefícios deve informar a duração correta.
- Um ticket ativo por usuário. Após confirmar o encerramento, o usuário pode abrir outro ticket.
- O estado fica no tópico do canal, para sobreviver a reinícios. Não edite manualmente os tópicos dos tickets. Não há banco de pedidos nem relatório financeiro.
- Pessoas com Administrador no servidor podem ver canais privados.
- Se alguém sair do servidor antes da aprovação, a equipe precisa resolver a compra antes de tentar liberar o cargo novamente.

## Referências oficiais

- Discord.js: https://discord.js.org/docs/packages/discord.js/14.25.1
- Manual de Padrões para Iniciação do Pix (Banco Central): https://www.bcb.gov.br/content/estabilidadefinanceira/pix/Regulamento_Pix/II_ManualdePadroesparaIniciacaodoPix.pdf
- Componentes e interações: https://github.com/discord/discord-api-docs/blob/main/developers/interactions/receiving-and-responding.mdx
- Permissões: https://github.com/discord/discord-api-docs/blob/main/developers/topics/permissions.mdx
