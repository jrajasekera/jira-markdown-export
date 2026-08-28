const { attachmentPlaceholder } = require('./attachments.js');

function descriptionToMd(content) {
  // Convert Jira ADF (Atlassian Document Format) to Markdown
  if (!content) return 'No description';

  return content
    .map(block => {
      switch (block.type) {
        case 'paragraph':
          return processParagraph(block.content);

        case 'heading':
          const level = block.attrs?.level || 1;
          const headingText = processContent(block.content);
          return `${'#'.repeat(level)} ${headingText}`;

        case 'bulletList':
          return block.content
            ?.map(item => `- ${processListItem(item)}`)
            .join('\n') || '';

        case 'orderedList':
          return block.content
            ?.map((item, i) => `${i + 1}. ${processListItem(item, ' '.repeat(String(i + 1).length + 2))}`)
            .join('\n') || '';

        case 'codeBlock':
          const lang = block.attrs?.language || '';
          const code = block.content?.map(c => c.text || '').join('') || '';
          return `\`\`\`${lang}\n${code}\n\`\`\``;

        case 'blockquote':
          const quoteText = block.content?.map(b => processParagraph(b.content)).join('\n\n') || '';
          return quoteText.split('\n').map(line => `> ${line}`).join('\n');

        case 'rule':
          return '---';

        case 'panel': {
          const panelLabels = {
            info: 'Info',
            note: 'Note',
            warning: 'Warning',
            error: 'Error',
            success: 'Success',
          };
          const label = panelLabels[block.attrs?.panelType] || 'Note';
          const body = descriptionToMd(block.content || []);
          const quoted = body ? body.split('\n').map(line => `> ${line}`).join('\n') : '';
          return quoted ? `> **${label}:**\n${quoted}` : `> **${label}:**`;
        }

        case 'taskList':
          return block.content
            ?.filter(item => item.type === 'taskItem')
            .map(item => `${item.attrs?.state === 'DONE' ? '- [x] ' : '- [ ] '}${processContent(item.content)}`)
            .join('\n') || '';

        case 'expand':
        case 'nestedExpand': {
          const title = block.attrs?.title || 'Details';
          const body = descriptionToMd(block.content || []);
          return `<details>\n<summary>${title}</summary>\n\n${body}\n\n</details>`;
        }

        case 'table':
          return processTable(block);

        case 'mediaSingle':
        case 'mediaGroup':
          return block.content
            ?.filter(child => child.type === 'media')
            .map(child => processMedia(child))
            .join('\n') || '';

        default:
          return `<!-- unsupported ADF block: ${block.type} -->`;
      }
    })
    .filter(line => line)
    .join('\n\n');
}

function processMedia(node) {
  const attrs = node.attrs || {};
  if (attrs.type === 'external') {
    return `![image](${attrs.url || ''})`;
  }
  return attachmentPlaceholder(attrs.id, attrs.alt);
}

function processTable(block) {
  const rows = (block.content || []).filter(r => r.type === 'tableRow');
  if (rows.length === 0) return '';

  const cellText = cell =>
    descriptionToMd(cell.content || [])
      .replace(/\n/g, '<br>')
      .replace(/\|/g, '\\|');

  const grid = rows.map(row => (row.content || []).map(cellText));
  const columns = grid.reduce((max, cells) => Math.max(max, cells.length), 0);
  if (columns === 0) return '';

  const line = cells => {
    const padded = [...cells];
    while (padded.length < columns) padded.push('');
    return `| ${padded.join(' | ')} |`;
  };

  const [header, ...body] = grid;
  const separator = `| ${Array(columns).fill('---').join(' | ')} |`;
  return [line(header), separator, ...body.map(line)].join('\n');
}

function indentBlock(text, prefix = '  ') {
  return text.split('\n').map(line => (line ? prefix + line : line)).join('\n');
}

// `prefix` is the indent of the item's content column, which depends on the
// marker width: two spaces for `- `, more for `10. `.
function processListItem(item, prefix = '  ') {
  if (item.type !== 'listItem' || !item.content || item.content.length === 0) return '';

  const [first, ...rest] = item.content;
  const head = first?.type === 'paragraph'
    ? processContent(first.content)
    // A non-paragraph first block may be multi-line (a code fence, a table);
    // every line but the first needs the item indent to stay inside the item.
    : indentBlock(descriptionToMd([first]), prefix).trimStart();
  if (rest.length === 0) return head;
  return `${head}\n${indentBlock(descriptionToMd(rest), prefix)}`;
}

function processContent(content) {
  if (!content) return '';

  return content
    .map(node => processNode(node))
    .join('');
}

function processParagraph(content) {
  return processContent(content);
}

function processNode(node) {
  if (!node) return '';

  switch (node.type) {
    case 'text':
      let text = node.text || '';

      // Apply marks (bold, italic, code, etc). Link is applied last so the
      // link wraps the formatted text: [**bold**](url).
      const marks = node.marks || [];
      const linkMark = marks.find(mark => mark.type === 'link');

      marks.forEach(mark => {
        switch (mark.type) {
          case 'strong':
            text = `**${text}**`;
            break;
          case 'em':
            text = `*${text}*`;
            break;
          case 'code':
            text = `\`${text}\``;
            break;
          case 'strike':
            text = `~~${text}~~`;
            break;
          case 'underline':
            text = `<u>${text}</u>`;
            break;
          case 'subsup':
            text = mark.attrs?.type === 'sup' ? `<sup>${text}</sup>` : `<sub>${text}</sub>`;
            break;
          case 'textColor':
            // Markdown has no colour; render the text unchanged.
            break;
        }
      });

      if (linkMark) {
        text = `[${text}](${linkMark.attrs?.href || ''})`;
      }

      return text;

    case 'hardBreak':
      return '\n';

    case 'inlineCard':
      const url = node.attrs?.url || '';
      return `[${url}](${url})`;

    case 'mention':
      const name = node.attrs?.text || 'Unknown';
      return `@${name}`;

    case 'emoji':
      return node.attrs?.shortName || '';

    case 'date': {
      const timestamp = Number(node.attrs?.timestamp);
      if (!Number.isFinite(timestamp)) return '';
      return new Date(timestamp).toISOString().split('T')[0];
    }

    case 'status':
      return `[${node.attrs?.text || ''}]`;

    case 'inlineExtension':
    case 'placeholder':
      return '';

    default:
      return '';
  }
}

module.exports = {
  descriptionToMd,
  processNode,
  processContent,
  processListItem,
};
