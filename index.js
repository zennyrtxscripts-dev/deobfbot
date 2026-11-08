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

async function sendMonitorEmbed(embed) {
  if (!MONITOR_CHANNEL_ID) return;
  try {
    const channel = await client.channels.fetch(MONITOR_CHANNEL_ID);
    if (channel) {
      await channel.send({ embeds: [embed] });
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

function getPreview(code, lines = 5) {
  const allLines = code.split('\n');
  const previewLines = allLines.slice(0, lines);
  let preview = previewLines.join('\n');
  if (allLines.length > lines) {
    preview += '\n...';
  }
  return preview;
}

client.once(Events.ClientReady, async () => {
  console.log('Bot online como ' + client.user.tag);

  if (REGISTER_COMMANDS) {
    try {
      const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
      console.log('Registrando comandos...');
      await rest.put(
        Routes.applicationGuildCommands(client.user.id, ALLOWED_GUILD_ID),
        { body: commands }
      );
      console.log('Comandos registrados! Mude REGISTER_COMMANDS para false agora.');
    } catch (error) {
      console.error('Erro ao registrar comandos:', error);
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
    return;
  }

  if (interaction.type === InteractionType.ApplicationCommand) {
    await interaction.deferReply();

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
    const engineName = engine === 'prometheus' ? 'Prometheus' : 'MoonSec V3';
    userSessions.delete(interaction.user.id);

    try {
      const res = await fetch(API_URL + ENGINE_ROUTES[engine], {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code, force: false })
      });

      const data = await res.json();

      if (!res.ok || !data.ok) {
        await interaction.editReply({
          content: 'Erro: ' + (data.error || 'Falha ao processar o código'),
          components: [],
          embeds: []
        });
        return;
      }

      const pasteLink = await createPastefy(data.code);
      const preview5 = getPreview(data.code, 5);

      const logEmbed = new EmbedBuilder()
        .setTitle('Código Desofuscado')
        .setColor(0x00ff00)
        .addFields(
          { name: 'Usuário', value: interaction.user.tag, inline: true },
          { name: 'Desofuscador', value: engineName, inline: true },
          { name: 'Link Pastefy', value: pasteLink || 'Não disponível', inline: false },
          { name: 'Preview', value: '```lua\n' + preview5 + '\n```', inline: false }
        )
        .setTimestamp();

      await sendMonitorEmbed(logEmbed);

      try {
        let dmMessage = 'Resultado - ' + engineName + '\n\n';
        if (pasteLink) {
          dmMessage += 'Link: ' + pasteLink + '\n\n';
        }
        dmMessage += '```lua\n' + preview5 + '\n```';
        await interaction.user.send({ content: dmMessage });
      } catch (e) {
        console.log('Não foi possível enviar na DM');
      }

      const confirmEmbed = new EmbedBuilder()
        .setTitle('Código enviado na sua DM')
        .setColor(0x2b2d31)
        .setDescription('Confira sua mensagem direta!');

      if (pasteLink) {
        confirmEmbed.setDescription('Confira sua mensagem direta!\nLink: ' + pasteLink);
      }

      await interaction.editReply({ embeds: [confirmEmbed], components: [] });

    } catch (err) {
      console.error(err);
      await interaction.editReply({
        content: 'Erro ao conectar com a API. Tente novamente mais tarde.',
        components: [],
        embeds: []
      });
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
        
