import { ChevronDown, ChevronUp, GripVertical } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { Animated, PanResponder, Pressable, Text, View } from 'react-native';

interface PriorityItem<T extends string> {
  id: T;
  label: string;
  subtitle?: string | undefined;
}

interface PriorityListProps<T extends string> {
  /** Items in their current priority order (first = tried first). */
  items: PriorityItem<T>[];
  onChange: (orderedIds: T[]) => void;
  /** Lets the parent ScrollView stop scrolling while a row is being dragged. */
  onDragStateChange?: (dragging: boolean) => void;
}

const ROW_HEIGHT = 56;
const GAP = 8;
const STRIDE = ROW_HEIGHT + GAP;

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

function move<T>(list: T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  if (item === undefined) return next; // `from` out of range: nothing to move
  next.splice(to, 0, item);
  return next;
}

interface DragCallbacks {
  start: () => void;
  move: (dy: number) => void;
  end: (dy: number | null) => void;
}

/** Drag handle with a PanResponder created once; it always calls the latest callbacks. */
interface DragHandleProps {
  label: string;
  callbacks: DragCallbacks;
}

function DragHandle({ label, callbacks }: DragHandleProps) {
  const latest = useRef(callbacks);
  useEffect(() => {
    latest.current = callbacks;
  });

  // The ref is read only inside gesture callbacks (never during render) — the standard
  // PanResponder pattern; the compiler can't tell that these closures run later.
  // eslint-disable-next-line react-hooks/refs
  const [responder] = useState(() =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => latest.current.start(),
      onPanResponderMove: (_e, g) => latest.current.move(g.dy),
      onPanResponderRelease: (_e, g) => latest.current.end(g.dy),
      onPanResponderTerminate: () => latest.current.end(null),
    })
  );

  return (
    <View
      {...responder.panHandlers}
      hitSlop={8}
      accessibilityLabel={`ลาก ${label} เพื่อจัดลำดับ`}
      className="h-full justify-center pr-1"
    >
      <GripVertical size={18} color="rgba(255,255,255,0.5)" />
    </View>
  );
}

/**
 * Drag-and-drop priority list (drag the grip handle), built on RN's PanResponder so it needs no
 * extra native gesture library. ↑/↓ buttons give the same control to screen-reader users.
 */
export function PriorityList<T extends string>({
  items,
  onChange,
  onDragStateChange,
}: PriorityListProps<T>) {
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null);
  const [dragY] = useState(() => new Animated.Value(0));

  const targetFor = (from: number, dy: number) =>
    clamp(Math.round(from + dy / STRIDE), 0, items.length - 1);

  const reorder = (from: number, to: number) => {
    if (to !== from) onChange(move(items, from, to).map((i) => i.id));
  };

  const callbacksFor = (index: number): DragCallbacks => ({
    start: () => {
      dragY.setValue(0);
      setDrag({ from: index, to: index });
      onDragStateChange?.(true);
    },
    move: (dy) => {
      dragY.setValue(dy);
      const to = targetFor(index, dy);
      setDrag((d) => (d && d.to !== to ? { ...d, to } : d));
    },
    end: (dy) => {
      setDrag(null);
      dragY.setValue(0);
      onDragStateChange?.(false);
      if (dy != null) reorder(index, targetFor(index, dy));
    },
  });

  /** Where a non-dragged row should sit while another row is hovering. */
  const shiftFor = (index: number) => {
    if (!drag || index === drag.from) return 0;
    if (drag.from < index && index <= drag.to) return -STRIDE;
    if (drag.to <= index && index < drag.from) return STRIDE;
    return 0;
  };

  return (
    <View style={{ height: items.length * STRIDE - GAP }}>
      {items.map((item, index) => {
        const dragging = drag?.from === index;
        return (
          // Animated.View carries only the motion; NativeWind classes live on the inner View
          <Animated.View
            key={item.id}
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: index * STRIDE,
              height: ROW_HEIGHT,
              zIndex: dragging ? 10 : 1,
              transform: [{ translateY: dragging ? dragY : shiftFor(index) }],
            }}
          >
            <View
              accessibilityLabel={`ลำดับ ${index + 1}: ${item.label}`}
              className={`h-full flex-row items-center gap-3 rounded-2xl border px-3 ${
                dragging ? 'border-sky-400/50 bg-[#1a2230]' : 'border-white/10 bg-white/5'
              }`}
            >
              <DragHandle label={item.label} callbacks={callbacksFor(index)} />
              <Text className="w-5 text-center text-sm font-semibold text-white/50">{index + 1}</Text>
              <View className="flex-1">
                <Text className="text-[15px] text-white" numberOfLines={1}>
                  {item.label}
                </Text>
                {item.subtitle && (
                  <Text className="text-xs text-white/40" numberOfLines={1}>
                    {item.subtitle}
                  </Text>
                )}
              </View>
              <Pressable
                onPress={() => reorder(index, index - 1)}
                disabled={index === 0}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel={`เลื่อน ${item.label} ขึ้น`}
                className={`p-1.5 ${index === 0 ? 'opacity-25' : ''}`}
              >
                <ChevronUp size={18} color="#fff" />
              </Pressable>
              <Pressable
                onPress={() => reorder(index, index + 1)}
                disabled={index === items.length - 1}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel={`เลื่อน ${item.label} ลง`}
                className={`p-1.5 ${index === items.length - 1 ? 'opacity-25' : ''}`}
              >
                <ChevronDown size={18} color="#fff" />
              </Pressable>
            </View>
          </Animated.View>
        );
      })}
    </View>
  );
}
