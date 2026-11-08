const { Client, GatewayIntentBits, Events, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require('discord.js');
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

const pendingCodes = new Map();

const commands = [
  {
    name: 'deobf',
    description: 'Use um link (Github, Pastebin, Pastefy) ou arquivo .lua/.txt',
    options: [
      {
        name: 'link',
        type: 3,
        description: 'Link do Github, Pastebin ou Pastefy',
        required: false
      },
      {
        name: 'arquivo',
        type: 11,
        description: 'Arquivo .lua ou .txt',
        required: false
      }
    ]
  }
];

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
  if (!PASTEFY_KEY) {
    console.log('Pastefy: CHAVE NAO CONFIGURADA');
    return null;
  }

  try {
    const res = await fetch('https://pastefy.app/api/v2/paste', {
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

    console.log('Pastefy status:', res.status);

    if (!res.ok) {
      const errorText = await res.text();
      console.log('Pastefy ERRO:', res.status, '->', errorText);
      return null;
    }

    const data = await res.json();
    console.log('Pastefy resposta recebida');

    if (data && data.paste) {
      const link = data.paste.raw_url || 'https://pastefy.app/' + data.paste.id + '/raw';
      console.log('Pastefy CRIADO COM SUCESSO:', link);
      return link;
    } else {
      console.log('Pastefy: resposta sem objeto paste', data);
      return null;
    }
  } catch (e) {
    console.log('Pastefy EXCECAO:', e.message);
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

async function fetchFromLink(input) {
  if (!input) return null;
  let url = input.trim();

  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return null;
  }

  try {
    if (url.includes('github.com') && url.includes('/blob/')) {
      url = url.replace('/blob/', '/raw/');
    }
    if (url.includes('pastebin.com/') && !url.includes('/raw/')) {
      const match = url.match(/pastebin\.com\/(?:raw\/)?([a-zA-Z0-9]+)/);
      if (match) url = 'https://pastebin.com/raw/' + match[1];
    }
    const res = await fetch(url);
    if (res.ok) return await res.text();
    return null;
  } catch (e) {
    return null;
  }
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

  if (interaction.type === 2) {
    await interaction.deferReply();

    const link = interaction.options.getString('link');
    const arquivo = interaction.options.getAttachment('arquivo');
    let code = null;

    if (arquivo && link) {
      await interaction.editReply('Use apenas um: link OU arquivo, não os dois juntos.');
      return;
    }

    if (!arquivo && !link) {
      await interaction.editReply('Use: /deobf link: URL ou anexe um arquivo .lua/.txt no comando.');
      return;
    }

    if (arquivo) {
      const nome = arquivo.name.toLowerCase();
      if (!nome.endsWith('.lua') && !nome.endsWith('.txt')) {
        await interaction.editReply('Formato invalido! Envie um arquivo .lua ou .txt');
        return;
      }
      try {
        const res = await fetch(arquivo.url);
        code = await res.text();
      } catch (e) {
        await interaction.editReply('Nao foi possivel ler o arquivo. Tente novamente.');
        return;
      }
    } else {
      code = await fetchFromLink(link);
      if (!code) {
        await interaction.editReply('Nao foi possivel buscar o conteudo. Verifique se o link é do Github, Pastebin ou Pastefy e tente novamente.');
        return;
      }
    }

    if (!code || code.trim().length === 0) {
      await interaction.editReply('Nenhum conteudo encontrado. Verifique e tente novamente.');
      return;
    }

    pendingCodes.set(interaction.user.id, code);

    const embed = new EmbedBuilder()
      .setTitle('Selecione o desfuscador')
      .setColor(0x2b2d31);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('sel_prometheus')
        .setLabel('Prometheus')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('sel_moonsec')
        .setLabel('MoonSec V3')
        .setStyle(ButtonStyle.Primary)
    );

    await interaction.editReply({ embeds: [embed], components: [row] });
  }

  if (interaction.type === 3) {
    await interaction.deferUpdate();

    let engine;
    if (interaction.customId === 'sel_prometheus') engine = 'prometheus';
    if (interaction.customId === 'sel_moonsec') engine = 'moonsec';
    if (!engine) return;

    const code = pendingCodes.get(interaction.user.id);
    if (!code) {
      await interaction.followUp({ content: 'Sessao expirada. Use /deobf novamente.', ephemeral: true });
      return;
    }
    pendingCodes.delete(interaction.user.id);

    const engineName = engine === 'prometheus' ? 'Prometheus' : 'MoonSec V3';

    try {
      const res = await fetch(API_URL + ENGINE_ROUTES[engine], {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code, force: false })
      });

      const data = await res.json();

      if (!res.ok || !data.ok) {
        await interaction.editReply({
          content: 'Erro: ' + (data.error || 'Falha ao processar o codigo'),
          components: [],
          embeds: []
        });
        return;
      }

      const pasteLink = await createPastefy(data.code);
      const preview5 = getPreview(data.code, 5);

      const logEmbed = new EmbedBuilder()
        .setTitle('Codigo Desofuscado')
        .setColor(0x000000)
        .addFields(
          { name: 'Usuario', value: interaction.user.tag, inline: true },
          { name: 'Desofuscador', value: engineName, inline: true },
          { name: 'Link Pastefy', value: pasteLink || 'Nao disponivel', inline: false },
          { name: 'Preview', value: '```lua\n' + preview5 + '\n```', inline: false }
        )
        .setTimestamp();

      await sendMonitorEmbed(logEmbed);

      try {
        const arquivoCompleto = new AttachmentBuilder(Buffer.from(data.code), { name: 'deobf.lua' });

        const dmEmbed = new EmbedBuilder()
          .setTitle('NovoAprendiz')
          .setColor(0x000000)
          .setDescription('Codigo enviado na sua dm\n```lua\n' + preview5 + '\n```\n\nPastefy: ' + (pasteLink || 'Nao disponivel'));

        await interaction.user.send({
          embeds: [dmEmbed],
          files: [arquivoCompleto]
        });
      } catch (e) {
        console.log('Nao foi possivel enviar na DM:', e.message);
        await interaction.followUp({
          content: 'Nao consegui enviar a mensagem direta. Verifique se suas DMs estao abertas.',
          ephemeral: true
        });
      }

      const confirmEmbed = new EmbedBuilder()
        .setTitle('Codigo enviado na sua DM')
        .setColor(0x2b2d31)
        .setDescription('Confira sua mensagem direta!\nArquivo completo enviado como .lua');

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
    
