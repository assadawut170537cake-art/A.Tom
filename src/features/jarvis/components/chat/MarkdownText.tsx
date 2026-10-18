import { memo, useMemo, type ReactNode } from 'react';
import { Linking, Platform, Text, View } from 'react-native';

import { parseMarkdown, type BlockNode, type InlineNode } from '../../utils/markdown';

const MONO = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });

function openLink(url: string) {
  // parser รับเฉพาะ http(s) อยู่แล้ว — เช็กซ้ำกัน scheme อื่นหลุดมาจากการแก้ parser ภายหลัง
  if (/^https?:\/\//i.test(url)) void Linking.openURL(url).catch(() => undefined);
}

function renderInline(nodes: InlineNode[], keyPrefix: string, accent: string): ReactNode[] {
  return nodes.map((node, i) => {
    const key = `${keyPrefix}-${i}`;
    switch (node.type) {
      case 'text':
        return node.text;
      case 'bold':
        return (
          <Text key={key} className="font-bold">
            {renderInline(node.children, key, accent)}
          </Text>
        );
      case 'italic':
        return (
          <Text key={key} className="italic">
            {renderInline(node.children, key, accent)}
          </Text>
        );
      case 'code':
        return (
          <Text key={key} className="bg-white/10 text-[13px] text-amber-200" style={{ fontFamily: MONO }}>
            {` ${node.text} `}
          </Text>
        );
      case 'link':
        return (
          <Text key={key} className="underline" style={{ color: accent }} onPress={() => openLink(node.url)}>
            {node.text}
          </Text>
        );
    }
  });
}

const HEADING_CLASS = { 1: 'text-[19px]', 2: 'text-[17px]', 3: 'text-[16px]' } as const;

function Block({ block, index, accent }: { block: BlockNode; index: number; accent: string }) {
  const key = `b${index}`;
  const spacing = index === 0 ? '' : 'mt-2';
  switch (block.type) {
    case 'paragraph':
      return (
        <Text className={`${spacing} text-[15px] leading-6 text-white`}>
          {renderInline(block.inline, key, accent)}
        </Text>
      );
    case 'heading':
      return (
        <Text className={`${spacing} ${HEADING_CLASS[block.level]} font-bold leading-7 text-white`}>
          {renderInline(block.inline, key, accent)}
        </Text>
      );
    case 'list':
      return (
        <View className={spacing}>
          {block.items.map((item, i) => (
            <View key={`${key}-${i}`} className="mt-0.5 flex-row">
              <Text className="w-6 text-[15px] leading-6 text-white/70">{item.marker}</Text>
              <Text className="flex-1 text-[15px] leading-6 text-white">
                {renderInline(item.inline, `${key}-${i}`, accent)}
              </Text>
            </View>
          ))}
        </View>
      );
    case 'quote':
      return (
        <View className={`${spacing} border-l-2 pl-3`} style={{ borderColor: accent }}>
          <Text className="text-[15px] leading-6 text-white/80">
            {renderInline(block.inline, key, accent)}
          </Text>
        </View>
      );
    case 'code':
    case 'table':
      return (
        <View className={`${spacing} rounded-lg bg-black/40 px-3 py-2`}>
          <Text className="text-[13px] leading-5 text-white/90" style={{ fontFamily: MONO }}>
            {block.text}
          </Text>
        </View>
      );
    case 'rule':
      return <View className={`${spacing} h-px bg-white/15`} />;
  }
}

interface MarkdownTextProps {
  text: string;
  /** สีลิงก์/เส้น quote — ใช้สีของ persona */
  accent: string;
}

/** ข้อความของผู้ช่วยแบบมีหัวข้อ ตัวหนา รายการ โค้ด (แทน `**` `#` ดิบ ๆ) */
export const MarkdownText = memo(function MarkdownText({ text, accent }: MarkdownTextProps) {
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  return (
    <View>
      {blocks.map((block, i) => (
        <Block key={i} block={block} index={i} accent={accent} />
      ))}
    </View>
  );
});
