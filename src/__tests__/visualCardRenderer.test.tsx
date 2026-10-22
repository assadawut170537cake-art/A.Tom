/**
 * @file Test Suite for VisualCardRenderer component
 */

import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { VisualCardRenderer } from '../features/jarvis/components/cards/VisualCardRenderer';

describe('VisualCardRenderer Component', () => {
  test('renders weather card correctly', async () => {
    await render(
      <VisualCardRenderer
        card={{
          type: 'weather',
          data: {
            city: 'สมุทรปราการ',
            temperature: 32,
            condition: 'มีเมฆบางส่วน',
            conditionCode: 2,
            humidity: 70,
            windSpeed: 15,
            forecast: [
              { day: 'พรุ่งนี้', tempMax: 34, tempMin: 26, condition: 'ฝนตก' },
            ],
          },
        }}
      />
    );

    expect(screen.getByTestId('card-weather')).toBeTruthy();
    expect(screen.getByText('สมุทรปราการ')).toBeTruthy();
    expect(screen.getByText('32°C')).toBeTruthy();
    expect(screen.getByText('มีเมฆบางส่วน')).toBeTruthy();
  });

  test('renders calendar card correctly', async () => {
    await render(
      <VisualCardRenderer
        card={{
          type: 'calendar',
          data: [
            {
              id: '1',
              title: 'ตรวจงานระบบ Mark-LV',
              startDate: new Date('2026-10-22T14:00:00'),
              endDate: new Date('2026-10-22T15:00:00'),
              location: 'ห้องวิจัย',
            },
          ],
        }}
      />
    );

    expect(screen.getByTestId('card-calendar')).toBeTruthy();
    expect(screen.getByText('ตรวจงานระบบ Mark-LV')).toBeTruthy();
  });

  test('renders reminder card correctly', async () => {
    await render(
      <VisualCardRenderer
        card={{
          type: 'reminder',
          data: {
            title: 'ส่งมอบงาน Boss',
            triggerTime: '15:30',
            isAlarm: false,
          },
        }}
      />
    );

    expect(screen.getByTestId('card-reminder')).toBeTruthy();
    expect(screen.getByText('การแจ้งเตือน')).toBeTruthy();
    expect(screen.getByText('ส่งมอบงาน Boss')).toBeTruthy();
  });

  test('renders device settings card correctly', async () => {
    await render(
      <VisualCardRenderer
        card={{
          type: 'device',
          data: {
            target: 'bluetooth',
            message: 'เปิดหน้าตั้งค่า bluetooth แล้ว',
          },
        }}
      />
    );

    expect(screen.getByTestId('card-device')).toBeTruthy();
    expect(screen.getByText('การตั้งค่าระบบ (bluetooth)')).toBeTruthy();
  });

  test('renders media card correctly', async () => {
    await render(
      <VisualCardRenderer
        card={{
          type: 'media',
          data: {
            title: 'Bodyslam - แสงสุดท้าย',
            app: 'spotify',
            query: 'แสงสุดท้าย bodyslam',
          },
        }}
      />
    );

    expect(screen.getByTestId('card-media')).toBeTruthy();
    expect(screen.getByText('Bodyslam - แสงสุดท้าย')).toBeTruthy();
    expect(screen.getByText('เปิดฟังบน Spotify')).toBeTruthy();
  });
});
