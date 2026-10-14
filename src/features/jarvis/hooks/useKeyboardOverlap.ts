import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { Dimensions, Keyboard, Platform, type KeyboardEvent, type View } from 'react-native';

/**
 * คีย์บอร์ดบังขอบล่างของ `container` อยู่กี่ px (0 = ไม่บัง)
 *
 * ทำไมไม่ใช้ KeyboardAvoidingView: ทุกอย่างบนหน้าหลักเป็น absolute และเราอยากยกเฉพาะช่องพิมพ์
 * กับรายการแชท (ไม่ยก ActionBar / แท็บล่างขึ้นมาด้วย) — จึงคำนวณแบบเดียวกับ KAV แต่ใช้พิกัด window:
 * overlap = ขอบล่างของ container − ขอบบนของคีย์บอร์ด
 *
 * ใช้ได้ทั้งสองกรณีของ Android: ถ้า OS ย่อ window ให้เอง (adjustResize) container จะเตี้ยลง → overlap = 0;
 * ถ้าไม่ย่อ (edge-to-edge) → overlap = ความสูงคีย์บอร์ดที่บังจริง
 */
export function useKeyboardOverlap(container: RefObject<View | null>) {
  const [overlap, setOverlap] = useState(0);
  const keyboardTop = useRef<number | null>(null);

  const measure = useCallback(() => {
    const top = keyboardTop.current;
    const node = container.current;
    if (top === null || !node) {
      setOverlap(0);
      return;
    }
    node.measureInWindow((_x, y, _width, height) => {
      setOverlap(Math.max(0, Math.round(y + height - top)));
    });
  }, [container]);

  useEffect(() => {
    const ios = Platform.OS === 'ios';
    const onShow = (e: KeyboardEvent) => {
      const { screenY, height } = e.endCoordinates;
      // iOS ที่เปิด "Prefer Cross-Fade Transitions" รายงาน screenY = 0 → คำนวณจากความสูงแทน
      keyboardTop.current = screenY || Dimensions.get('window').height - height;
      measure();
    };
    const onHide = () => {
      keyboardTop.current = null;
      setOverlap(0);
    };
    const subs = [
      Keyboard.addListener(ios ? 'keyboardWillChangeFrame' : 'keyboardDidShow', onShow),
      Keyboard.addListener(ios ? 'keyboardWillHide' : 'keyboardDidHide', onHide),
    ];
    return () => subs.forEach((s) => s.remove());
  }, [measure]);

  /** ส่งให้ onLayout ของ container — วัดใหม่เมื่อขนาดเปลี่ยนระหว่างคีย์บอร์ดเปิด */
  return { overlap, onContainerLayout: measure };
}
