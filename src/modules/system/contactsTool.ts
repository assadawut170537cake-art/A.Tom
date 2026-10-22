/**
 * @file Contacts Tool: ค้นหารายชื่อและเตรียมโทรออกผ่าน expo-contacts & Linking
 */

import * as Contacts from 'expo-contacts';
import { Linking } from 'react-native';

export interface ContactItem {
  id: string;
  name: string;
  phoneNumbers?: string[] | undefined;
  emails?: string[] | undefined;
}

export async function searchContacts(query: string): Promise<ContactItem[]> {
  const { status } = await Contacts.requestPermissionsAsync();
  if (status !== 'granted') {
    throw new Error('ไม่ได้รับสิทธิ์เข้าถึงรายชื่อ');
  }

  const { data } = await Contacts.getContactsAsync({
    name: query,
    fields: [Contacts.Fields.Name, Contacts.Fields.PhoneNumbers, Contacts.Fields.Emails],
  });

  return data
    .filter((c) => c.name)
    .map((c) => {
      const phones = c.phoneNumbers?.map((p) => p.number || '').filter(Boolean);
      const emailList = c.emails?.map((e) => e.email || '').filter(Boolean);
      return {
        id: c.id,
        name: c.name,
        ...(phones?.length ? { phoneNumbers: phones } : {}),
        ...(emailList?.length ? { emails: emailList } : {}),
      };
    });
}

export async function callPhoneNumber(phoneNumber: string): Promise<boolean> {
  const cleanNumber = phoneNumber.replace(/[^0-9+]/g, '');
  const url = `tel:${cleanNumber}`;
  const supported = await Linking.canOpenURL(url);
  if (!supported) {
    throw new Error(`อุปกรณ์ไม่รองรับการโทร: ${cleanNumber}`);
  }
  await Linking.openURL(url);
  return true;
}
