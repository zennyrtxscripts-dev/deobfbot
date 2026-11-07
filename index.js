const { Client, GatewayIntentBits, Collection, Events, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, InteractionType } = require('discord.js');
const { REST, Routes } = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ]
});

// ⚙️ CONFIGURAÇÕES
const ALLOWED_GUILD_ID = '1471596336603205848';
const API_URL = process.env.API_URL;
const ENGINE_ROUTES = {
  prometheus: '/api/public/deobfuscate/prometheus',
  moonsec: '/api/public/deobfuscate/moonsec'
};

const userSessions = new Map();

// Comando /deobf
const commands = [
  {
    name: 'deobf',
    description: 'Envia um código ou arquivo para desofuscar',
  }
];

// Inicializar
client.once(Events.ClientReady, async () => {
  console.log(`✅ Bot online como ${client.user.tag}`);
  
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  await rest.put(
    Routes.applicationCommands(client.user.id),
    { body: commands }
  );
  console.log('✅ Comandos registrados');
});

// Verificar acesso
client.on(Events.InteractionCreate, async interaction => {
  if (interaction.guildId !== ALLOWED_GUILD_ID) {
    if (interaction.replied || interaction.deferred) return;
    return interaction.reply({
      content: 'Acesso negado, entre no servidor oficial\nhttps://discord.gg/pNNdX945zz',
      ephemeral: true
    });
  }

  // Comando /deobf
  if (interaction.type === InteractionType.ApplicationCommand) {
    await interaction.deferReply({ ephemeral: false });

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

  // Botão clicado
  if (interaction.type === InteractionType.MessageComponent) {
    await interaction.deferUpdate();
    
    let selectedEngine;
    if (interaction.customId === 'select_prometheus') selectedEngine = 'prometheus';
    else if (interaction.customId === 'select_moonsec') selectedEngine = 'moonsec';
    else return;

    userSessions.set(interaction.user.id, { engine: selectedEngine });

    const modal = new ModalBuilder()
      .setCustomId(`input_${selectedEngine}`)
      .setTitle('Cole seu código');
    
    const codeInput = new TextInputBuilder()
      .setCustomId('code')
      .setLabel('Código ofuscado ou link')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true);
    
    const modalRow = new ActionRowBuilder().addComponents(codeInput);
    modal.addComponents(modalRow);
    
    await interaction.showModal(modal);
  }

  // Modal enviado
  if (interaction.type === InteractionType.ModalSubmit) {
    await interaction.deferReply({ ephemeral: false });
    
    const session = userSessions.get(interaction.user.id);
    if (!session) return;
    
    const code = interaction.fields.getTextInputValue('code');
    const engine = session.engine;
    userSessions.delete(interaction.user.id);

    // Chamar API — SEM chave de autorização
    try {
      const res = await fetch(API_URL + ENGINE_ROUTES[engine], {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ code, force: false })
      });

      const data = await res.json();

      if (!res.ok || !data.ok) {
        return interaction.editReply({
          content: `❌ Erro: ${data.error || 'Falha ao processar o código'}`,
          components: [],
          embeds: []
        });
      }

      // Enviar na DM
      try {
        const engineName = engine === 'prometheus' ? 'Prometheus' : 'MoonSec V3';
        const preview = data.code.slice(0, 500) + (data.code.length > 500 ? '\n...(código completo na mensagem abaixo)' : '');
        await interaction.user.send({
          content: `✅ **Resultado - ${engineName}**\n\n\`\`\`lua\n${preview}\n\`\`\``
        });
        if (data.code.length > 2000) {
          await interaction.user.send({
            content: '📄 Arquivo completo:',
            files: [{ attachment: Buffer.from(data.code), name: 'resultado.lua' }]
          });
        }
      } catch (e) {
        console.log('Não consegui enviar na DM');
      }

      const confirmEmbed = new EmbedBuilder()
        .setTitle('Código enviado na sua DM')
        .setColor(0x2b2d31)
        .setDescription('Confira sua mensagem direta! ✅');

      await interaction.editReply({ embeds: [confirmEmbed], components: [] });

    } catch (err) {
      console.error(err);
      await interaction.editReply({
        content: '❌ Erro ao conectar com a API. Tente novamente mais tarde.',
        components: [],
        embeds: []
      });
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
