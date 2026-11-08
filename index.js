const { Client, GatewayIntentBits, Events, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, InteractionType } = require('discord.js');
const { REST, Routes } = require('discord.js');

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const ALLOWED_GUILD_ID = process.env.ALLOWED_GUILD_ID;
const MONITOR_CHANNEL_ID = process.env.MONITOR_CHANNEL_ID;
const API_URL = process.env.API_URL;
const PASTEFY_KEY = process.env.PASTEFY_KEY;
const REGISTER_COMMANDS = process.env.REGISTER_COMMANDS === 'true';

const ENGINE_ROUTES = {
  prometheus: '/api/public/deobfuscate/prometheus',
  moonsec: '/api/public/deobfuscate/moonsec'
};

const commands = [
  {
    name: 'deobf',
    description: 'Envia um código para desofuscar'
  }
];

const userSessions = new Map();

async function sendMonitorLog(message) {
  if (!MONITOR_CHANNEL_ID) return;
  try {
    const channel = await client.channels.fetch(MONITOR_CHANNEL_ID);
    if (channel) {
      await channel.send({ content: message, allowedMentions: { parse: [] } });
    }
  } catch (e) {
    console.log('Log não enviado:', e.message);
  }
}

async function createPastefy(content) {
  try {
    const res = await fetch('https://pastefy.app/api/v2/pastes', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + PASTEFY_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        title: 'Resultado Desofuscado',
        content: content,
        visibility: 'UNLISTED'
      })
    });
    const data = await res.json();
    if (data && data.id) {
      return 'https://pastefy.app/' + data.id;
    }
    return null;
  } catch (e) {
    console.log('Erro no Pastefy:', e);
    return null;
  }
}

client.once(Events.ClientReady, async () => {
  console.log('Bot online como ' + client.user.tag);
  sendMonitorLog('✅ Bot ligado e pronto!');

  if (REGISTER_COMMANDS) {
    try {
      const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
      console.log('Registrando comandos...');
      await rest.put(
        Routes.applicationGuildCommands(client.user.id, ALLOWED_GUILD_ID),
        { body: commands }
      );
      console.log('Comandos registrados! Mude REGISTER_COMMANDS para false agora.');
      sendMonitorLog('✅ Comandos registrados com sucesso!');
    } catch (error) {
      console.error('Erro ao registrar comandos:', error);
      sendMonitorLog('❌ Erro ao registrar comandos: ' + error.message);
    }
  }
});

client.on(Events.InteractionCreate, async interaction => {
  if (interaction.guildId !== ALLOWED_GUILD_ID) {
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: 'Acesso negado, entre no servidor oficial\nhttps://discord.gg/pNNdX945zz',
        ephemeral: true
      });
    }
    sendMonitorLog('⚠️ Acesso negado — Servidor: ' + interaction.guildId + ' | Usuário: ' + interaction.user.tag);
    return;
  }

  if (interaction.type === InteractionType.ApplicationCommand) {
    await interaction.deferReply();
    sendMonitorLog('📥 Comando /deobf usado por ' + interaction.user.tag);

    const embed = new EmbedBuilder()
      .setTitle('Selecione o desfuscador')
      .setColor(0x2b2d31);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('select_prometheus')
        .setLabel('Prometheus')
        .setEmoji('🌻')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('select_moonsec')
        .setLabel('MoonSec V3')
        .setEmoji('🌚')
        .setStyle(ButtonStyle.Primary)
    );

    await interaction.editReply({ embeds: [embed], components: [row] });
  }

  if (interaction.type === InteractionType.MessageComponent) {
    await interaction.deferUpdate();

    let selectedEngine;
    if (interaction.customId === 'select_prometheus') selectedEngine = 'prometheus';
    if (interaction.customId === 'select_moonsec') selectedEngine = 'moonsec';
    if (!selectedEngine) return;

    sendMonitorLog('🔘 ' + interaction.user.tag + ' escolheu: ' + selectedEngine);
    userSessions.set(interaction.user.id, { engine: selectedEngine });

    const modal = new ModalBuilder()
      .setCustomId('input_modal')
      .setTitle('Cole seu código');

    const codeInput = new TextInputBuilder()
      .setCustomId('code')
      .setLabel('Código ofuscado')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true);

    const modalRow = new ActionRowBuilder().addComponents(codeInput);
    modal.addComponents(modalRow);

    await interaction.showModal(modal);
  }

  if (interaction.type === InteractionType.ModalSubmit) {
    await interaction.deferReply();

    const session = userSessions.get(interaction.user.id);
    if (!session) return;

    const code = interaction.fields.getTextInputValue('code');
    const engine = session.engine;
    userSessions.delete(interaction.user.id);

    sendMonitorLog('🔄 Processando ' + engine + ' para ' + interaction.user.tag + ' — ' + code.length + ' caracteres');

    try {
      const res = await fetch(API_URL + ENGINE_ROUTES[engine], {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code, force: false })
      });

      const data = await res.json();

      if (!res.ok || !data.ok) {
        sendMonitorLog('❌ Erro da API: ' + (data.error || 'Erro desconhecido'));
        await interaction.editReply({
          content: 'Erro: ' + (data.error || 'Falha ao processar o código'),
          components: [],
          embeds: []
        });
        return;
      }

      const engineName = engine === 'prometheus' ? 'Prometheus' : 'MoonSec V3';
      const pasteLink = await createPastefy(data.code);

      sendMonitorLog('✅ Sucesso — ' + engineName + (pasteLink ? ' — ' + pasteLink : ' — enviado na DM'));

      try {
        let dmMessage = '✅ Resultado - ' + engineName + '\n\n';
        if (pasteLink) {
          dmMessage += '📄 Link: ' + pasteLink + '\n\n';
        }
        const preview = data.code.slice(0, 500);
        dmMessage += '```lua\n' + preview + '\n```';
        if (data.code.length > 500) {
          dmMessage += '\n...(código completo no link)';
        }
        await interaction.user.send({ content: dmMessage });
      } catch (e) {
        sendMonitorLog('⚠️ Não foi possível enviar na DM para ' + interaction.user.tag);
      }

      const confirmEmbed = new EmbedBuilder()
        .setTitle('Código enviado na sua DM')
        .setColor(0x2b2d31);
      
      if (pasteLink) {
        confirmEmbed.setDescription('Confira sua mensagem direta!\n📄 Link: ' + pasteLink);
      } else {
        confirmEmbed.setDescription('Confira sua mensagem direta! ✅');
      }

      await interaction.editReply({ embeds: [confirmEmbed], components: [] });

    } catch (err) {
      console.error(err);
      sendMonitorLog('❌ Erro geral: ' + err.message);
      await interaction.editReply({
        content: 'Erro ao conectar com a API. Tente novamente mais tarde.',
        components: [],
        embeds: []
      });
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
        
