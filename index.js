const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  SlashCommandBuilder
} = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// === CONFIGURAÇÃO ===
const CONFIG = {
  TOKEN: process.env.TOKEN,
  GUILD_ID: process.env.GUILD_ID,
  MONITOR_CHANNEL_ID: process.env.MONITOR_CHANNEL_ID,
  DEOBF_API_URL: process.env.DEOBF_API_URL,
  DEOBF_API_KEY: process.env.DEOBF_API_KEY,
  PASTEFY_API_URL: 'https://pastefy.app/api/v2',
  PASTEFY_KEY: process.env.PASTEFY_KEY
};

const rest = new REST({ version: '10' }).setToken(CONFIG.TOKEN);

const comando = new SlashCommandBuilder()
  .setName('deobf')
  .setDescription('Desofusque um código Lua/Luau')
  .addStringOption(opt =>
    opt.setName('raw')
      .setDescription('Link bruto do código')
      .setRequired(false))
  .addAttachmentOption(opt =>
    opt.setName('arquivo')
      .setDescription('Arquivo .lua')
      .setRequired(false));

client.on('ready', async () => {
  console.log(`✅ Logado como ${client.user.tag}`);
  try {
    await rest.put(
      Routes.applicationGuildCommands(client.user.id, CONFIG.GUILD_ID),
      { body: [comando.toJSON()] }
    );
    console.log('✅ Comando /deobf pronto!');
  } catch (err) {
    console.error('❌ Erro ao registrar comando:', err);
  }
});

async function baixarCodigo(url) {
  try {
    const res = await fetch(url);
    return res.ok ? await res.text() : null;
  } catch { return null; }
}

async function desofuscar(script, force = false) {
  try {
    const res = await fetch(CONFIG.DEOBF_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${CONFIG.DEOBF_API_KEY}`
      },
      body: JSON.stringify({ script, force })
    });
    return await res.json();
  } catch {
    return { ok: false, error: 'Serviço indisponível' };
  }
}

async function enviarPastefy(conteudo) {
  try {
    const res = await fetch(`${CONFIG.PASTEFY_API_URL}/paste`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${CONFIG.PASTEFY_KEY}`
      },
      body: JSON.stringify({
        content: conteudo,
        title: 'deobf.lua',
        visibility: 'unlisted'
      })
    });
    const dados = await res.json();
    return dados.url || `https://pastefy.app/${dados.id}`;
  } catch { return null; }
}

const cacheCodigos = new Map();

client.on('interactionCreate', async int => {
  if (int.guildId !== CONFIG.GUILD_ID) {
    if (int.isChatInputCommand()) await int.reply({
      content: 'Acesso negado, entre no servidor oficial\nhttps://discord.gg/pNNdX945zz',
      ephemeral: true
    });
    return;
  }

  if (int.isChatInputCommand() && int.commandName === 'deobf') {
    await int.deferReply();
    const linkRaw = int.options.getString('raw');
    const arquivo = int.options.getAttachment('arquivo');
    let codigo;

    if (linkRaw) {
      codigo = await baixarCodigo(linkRaw);
      if (!codigo) return int.editReply('Não consegui ler esse link. Verifique se é um link bruto.');
    } else if (arquivo) {
      if (!arquivo.name.endsWith('.lua')) return int.editReply('Envie um arquivo .lua');
      codigo = await baixarCodigo(arquivo.url);
    } else {
      return int.editReply('Use: /deobf raw: link ou /deobf arquivo: arquivo.lua');
    }

    cacheCodigos.set(int.user.id, codigo);

    const embed = new EmbedBuilder()
      .setTitle('NovoAprendiz')
      .setDescription('Selecione o desfuscador');

    const botao = new ButtonBuilder()
      .setCustomId('deobf_prometheus')
      .setLabel('Prometheus')
      .setEmoji('🌻')
      .setStyle(ButtonStyle.Primary);

    await int.editReply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(botao)] });
  }

  if (int.isButton() && int.customId === 'deobf_prometheus') {
    await int.deferUpdate();
    const codigo = cacheCodigos.get(int.user.id);
    if (!codigo) return int.followUp({ content: 'Sessão expirada. Use /deobf novamente.', ephemeral: true });

    const res = await desofuscar(codigo);
    if (!res.ok) return int.followUp({ content: `Erro: ${res.error || 'Não foi possível desofuscar'}`, ephemeral: true });

    const preview = res.code.split('\n').slice(0, 5).join('\n');
    const linkPaste = await enviarPastefy(res.code);
    const arquivo = Buffer.from(res.code, 'utf-8');

    try {
      const dmEmbed = new EmbedBuilder().setDescription(
        `Código enviado na sua dm\n\n\`\`\`lua\n${preview}\n\`\`\`\n${linkPaste ? `Pastefy: ${linkPaste}` : ''}`
      );
      await int.user.send({ embeds: [dmEmbed], files: [{ attachment: arquivo, name: 'deobf.lua' }] });
      await int.followUp({ content: 'Código enviado na sua dm', ephemeral: true });
    } catch {
      await int.followUp({ content: 'Não consegui te enviar mensagem direta.', ephemeral: true });
    }

    const canal = client.channels.cache.get(CONFIG.MONITOR_CHANNEL_ID);
    if (canal) {
      const logEmbed = new EmbedBuilder()
        .setAuthor({ name: int.user.tag, iconURL: int.user.displayAvatarURL() })
        .setDescription(`\`\`\`lua\n${preview}\n\`\`\`\n${linkPaste || 'Pastefy indisponível'}`)
        .setTimestamp();
      await canal.send({ embeds: [logEmbed], files: [{ attachment: arquivo, name: 'deobf.lua' }] }).catch(() => {});
    }

    cacheCodigos.delete(int.user.id);
  }
});

client.login(CONFIG.TOKEN);
      
