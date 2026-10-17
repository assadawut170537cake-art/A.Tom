import { useMemo } from 'react';
import { Pressable, Text, View } from 'react-native';
import Svg, { Circle, Polyline } from 'react-native-svg';

import type { AgentScreenProps } from '../../../core/agents/types';
import { FALLBACK_CHECKPOINTS } from './checkpoints';
import { calculateAvoidanceRoute, DEMO_DESTINATION, DEMO_ORIGIN, type Coord } from './routingEngine';

const MAP_SIZE = 220;
const PADDING = 14;

/**
 * UI ของ agent "หน่วยคุ้มกันเส้นทาง": แผนที่ย่อ (SVG) แสดงเส้นทางเลี่ยง + จุดตรวจ/กล้อง + วงรัศมีเลี่ยง
 * วาดด้วย react-native-svg ที่มีอยู่แล้ว (ไม่เพิ่ม dependency แผนที่) — ฉายพิกัดแบบเส้นตรงพอสำหรับระยะไม่กี่กิโลเมตร
 */
export function RouteEscortScreen({ onClose }: AgentScreenProps) {
  const route = useMemo(
    () => calculateAvoidanceRoute(DEMO_ORIGIN, DEMO_DESTINATION, FALLBACK_CHECKPOINTS),
    []
  );

  const project = useMemo(() => {
    const points: Coord[] = [...route.waypoints, ...FALLBACK_CHECKPOINTS];
    const lats = points.map((p) => p.lat);
    const lons = points.map((p) => p.lon);
    const minLat = Math.min(...lats);
    const minLon = Math.min(...lons);
    const spanLat = Math.max(...lats) - minLat || 1;
    const spanLon = Math.max(...lons) - minLon || 1;
    const inner = MAP_SIZE - PADDING * 2;
    return (p: Coord) => ({
      x: PADDING + ((p.lon - minLon) / spanLon) * inner,
      // แกน y ของจอกลับด้านกับละติจูด
      y: PADDING + (1 - (p.lat - minLat) / spanLat) * inner,
    });
  }, [route]);

  const linePoints = route.waypoints
    .map((wp) => {
      const { x, y } = project(wp);
      return `${x},${y}`;
    })
    .join(' ');

  return (
    <View className="gap-3 p-3">
      <View className="flex-row items-center justify-between">
        <Text className="text-base font-semibold text-white">หน่วยคุ้มกันเส้นทาง</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="ปิดหน้าหน่วยคุ้มกันเส้นทาง" hitSlop={8} onPress={onClose}>
          <Text className="text-sm text-white/60">ปิด</Text>
        </Pressable>
      </View>

      <Svg width={MAP_SIZE} height={MAP_SIZE} accessibilityLabel="แผนที่ย่อเส้นทางเลี่ยงด่าน">
        {FALLBACK_CHECKPOINTS.map((cp) => {
          const { x, y } = project(cp);
          const color = cp.type === 'traffic_jam' ? '#f59e0b' : '#ef4444';
          return (
            <Circle key={cp.id} cx={x} cy={y} r={8} fill={color} fillOpacity={0.25} stroke={color} strokeWidth={1} />
          );
        })}
        <Polyline points={linePoints} fill="none" stroke="#22d3ee" strokeWidth={2} />
      </Svg>

      <View>
        <Text className="text-sm text-white">
          เลี่ยง {route.avoidedCheckpointsCount} จุด · {route.distanceKm.toFixed(2)} กม. · ~{Math.round(route.durationMin)} นาที
        </Text>
        <Text className="mt-1 text-xs text-white/40">ข้อมูลจำลองแบบ offline — ยังไม่เชื่อมแหล่งข้อมูลจริง</Text>
      </View>
    </View>
  );
}
