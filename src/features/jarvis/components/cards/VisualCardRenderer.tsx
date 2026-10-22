/**
 * @file VisualCardRenderer: เรนเดอร์การ์ดกราฟิกแบบอินเทอร์แอคทีฟ (Show Card) ตามผลลัพธ์ของ Tool ขณะ AI พูด
 */

import React from 'react';
import { StyleSheet, Text, View, Pressable, Linking } from 'react-native';
import {
  CloudSun,
  Calendar,
  Bell,
  Phone,
  Settings,
  ExternalLink,
  Music,
} from 'lucide-react-native';
import type { WeatherData } from '../../../../modules/system/weatherTool';
import type { CalendarEventItem } from '../../../../modules/system/calendarTool';
import type { ContactItem } from '../../../../modules/system/contactsTool';

export type VisualCardData =
  | { type: 'weather'; data: WeatherData }
  | { type: 'calendar'; data: CalendarEventItem[] }
  | { type: 'reminder'; data: { title: string; triggerTime: string; isAlarm?: boolean } }
  | { type: 'contact'; data: ContactItem }
  | { type: 'device'; data: { target: string; message: string; onAction?: () => void } }
  | { type: 'media'; data: { title: string; app: 'spotify'; query: string } };

interface Props {
  card: VisualCardData;
}

export const VisualCardRenderer: React.FC<Props> = ({ card }) => {
  switch (card.type) {
    case 'weather': {
      const { data } = card;
      return (
        <View style={styles.cardContainer} testID="card-weather">
          <View style={styles.cardHeader}>
            <CloudSun size={24} color="#38bdf8" />
            <Text style={styles.cardTitle}>{data.city || 'สภาพอากาศ'}</Text>
          </View>
          <View style={styles.weatherMain}>
            <Text style={styles.weatherTemp}>{data.temperature}°C</Text>
            <View>
              <Text style={styles.weatherCondition}>{data.condition}</Text>
              {data.humidity !== undefined && (
                <Text style={styles.weatherSub}>ความชื้น {data.humidity}% · ลม {data.windSpeed} km/h</Text>
              )}
            </View>
          </View>
          {data.forecast && data.forecast.length > 0 && (
            <View style={styles.forecastRow}>
              {data.forecast.slice(0, 4).map((f, i) => (
                <View key={i} style={styles.forecastItem}>
                  <Text style={styles.forecastDay}>{f.day}</Text>
                  <Text style={styles.forecastTemp}>{f.tempMax}° / {f.tempMin}°</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      );
    }

    case 'calendar': {
      const { data } = card;
      return (
        <View style={styles.cardContainer} testID="card-calendar">
          <View style={styles.cardHeader}>
            <Calendar size={22} color="#a855f7" />
            <Text style={styles.cardTitle}>กำหนดการในปฏิทิน ({data.length} รายการ)</Text>
          </View>
          {data.length === 0 ? (
            <Text style={styles.emptyText}>ไม่มีนัดหมายในช่วงเวลานี้</Text>
          ) : (
            data.slice(0, 3).map((item, idx) => (
              <View key={item.id || idx} style={styles.calendarItem}>
                <View style={styles.dot} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.itemTitle}>{item.title}</Text>
                  <Text style={styles.itemSubtitle}>
                    {item.startDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    {item.location ? ` · ${item.location}` : ''}
                  </Text>
                </View>
              </View>
            ))
          )}
        </View>
      );
    }

    case 'reminder': {
      const { data } = card;
      return (
        <View style={styles.cardContainer} testID="card-reminder">
          <View style={styles.cardHeader}>
            <Bell size={22} color="#f59e0b" />
            <Text style={styles.cardTitle}>{data.isAlarm ? 'นาฬิกาปลุก' : 'การแจ้งเตือน'}</Text>
          </View>
          <Text style={styles.itemTitle}>{data.title}</Text>
          <Text style={styles.itemSubtitle}>ตั้งเวลาไว้: {data.triggerTime}</Text>
        </View>
      );
    }

    case 'contact': {
      const { data } = card;
      const phone = data.phoneNumbers?.[0];
      return (
        <View style={styles.cardContainer} testID="card-contact">
          <View style={styles.cardHeader}>
            <Phone size={22} color="#10b981" />
            <Text style={styles.cardTitle}>ข้อมูลผู้ติดต่อ</Text>
          </View>
          <Text style={styles.itemTitle}>{data.name}</Text>
          {phone ? (
            <Pressable
              style={styles.actionBtn}
              onPress={() => Linking.openURL(`tel:${phone.replace(/[^0-9+]/g, '')}`)}
            >
              <Phone size={16} color="#fff" />
              <Text style={styles.actionBtnText}>โทรออก {phone}</Text>
            </Pressable>
          ) : (
            <Text style={styles.itemSubtitle}>ไม่มีเบอร์โทรศัพท์ที่บันทึกไว้</Text>
          )}
        </View>
      );
    }

    case 'device': {
      const { data } = card;
      return (
        <View style={styles.cardContainer} testID="card-device">
          <View style={styles.cardHeader}>
            <Settings size={22} color="#06b6d4" />
            <Text style={styles.cardTitle}>การตั้งค่าระบบ ({data.target})</Text>
          </View>
          <Text style={styles.itemSubtitle}>{data.message}</Text>
        </View>
      );
    }

    case 'media': {
      const { data } = card;
      return (
        <View style={styles.cardContainer} testID="card-media">
          <View style={styles.cardHeader}>
            <Music size={22} color="#1db954" />
            <Text style={styles.cardTitle}>Spotify</Text>
          </View>
          <Text style={styles.itemTitle}>{data.title}</Text>
          <Pressable
            style={[styles.actionBtn, { backgroundColor: '#1db954' }]}
            onPress={() => Linking.openURL(`spotify:search:${encodeURIComponent(data.query)}`)}
          >
            <ExternalLink size={16} color="#fff" />
            <Text style={styles.actionBtnText}>เปิดฟังบน Spotify</Text>
          </Pressable>
        </View>
      );
    }

    default:
      return null;
  }
};

const styles = StyleSheet.create({
  cardContainer: {
    backgroundColor: 'rgba(255, 255, 255, 0.07)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    padding: 14,
    marginVertical: 6,
    width: '100%',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  cardTitle: {
    color: '#e2e8f0',
    fontSize: 14,
    fontWeight: '600',
  },
  weatherMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginVertical: 4,
  },
  weatherTemp: {
    color: '#fff',
    fontSize: 32,
    fontWeight: '700',
  },
  weatherCondition: {
    color: '#cbd5e1',
    fontSize: 15,
    fontWeight: '500',
  },
  weatherSub: {
    color: '#94a3b8',
    fontSize: 12,
    marginTop: 2,
  },
  forecastRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
  },
  forecastItem: {
    alignItems: 'center',
  },
  forecastDay: {
    color: '#94a3b8',
    fontSize: 11,
  },
  forecastTemp: {
    color: '#e2e8f0',
    fontSize: 11,
    fontWeight: '500',
    marginTop: 2,
  },
  calendarItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 6,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#38bdf8',
  },
  itemTitle: {
    color: '#f8fafc',
    fontSize: 14,
    fontWeight: '600',
  },
  itemSubtitle: {
    color: '#94a3b8',
    fontSize: 12,
    marginTop: 2,
  },
  emptyText: {
    color: '#64748b',
    fontSize: 13,
    fontStyle: 'italic',
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#0284c7',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    marginTop: 10,
  },
  actionBtnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
});
