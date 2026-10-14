import { memo, useCallback, useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import { isRecord, parseJSON } from '../../../../core/types/guards';
import { LAYOUT, MOOD_TO_ORB_STATE } from '../../constants';
import { ORB_HTML } from '../../constants/orbHtml';
import type { OrbMood, Persona } from '../../types';

const SOURCE = { html: ORB_HTML };
const ORIGIN_WHITELIST = ['*'];

/** Asks an already-loaded page to re-send 'ready' (covers a message lost before the bridge attached). */
const READY_PROBE = `
  if (window.__orbReady && window.ReactNativeWebView) {
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'ready' }));
  }
  true;
`;

interface OrbWebViewProps {
  persona: Persona;
  mood: OrbMood;
}

export const OrbWebView = memo(function OrbWebView({ persona, mood }: OrbWebViewProps) {
  const webRef = useRef<WebView>(null);
  const hasInit = useRef(false);
  const queue = useRef<string[]>([]);

  const flush = useCallback(() => {
    if (!queue.current.length) return;
    const script = queue.current.join(';\n');
    queue.current = [];
    webRef.current?.injectJavaScript(`try { ${script}; } catch (e) {} true;`);
  }, []);

  const run = useCallback(
    (js: string) => {
      queue.current.push(js);
      if (hasInit.current) flush();
    },
    [flush]
  );

  // Queued until the page reports ready, then flushed in order
  useEffect(() => {
    run(`window.setOrbPersona(${persona})`);
  }, [persona, run]);

  useEffect(() => {
    run(`window.setOrbState('${MOOD_TO_ORB_STATE[mood]}')`);
  }, [mood, run]);

  const markReady = useCallback(() => {
    if (hasInit.current) return; // onLoadEnd probe + onMessage can both deliver 'ready'
    hasInit.current = true;
    flush();
  }, [flush]);

  const onMessage = useCallback(
    (e: WebViewMessageEvent) => {
      // Anything that isn't a JSON object (e.g. stray console bridging) is ignored
      const data = parseJSON(e.nativeEvent.data, isRecord);
      if (data?.type === 'ready') markReady();
    },
    [markReady]
  );

  const onLoadEnd = useCallback(() => {
    if (!hasInit.current) webRef.current?.injectJavaScript(READY_PROBE);
  }, []);

  // The page lost its state (renderer killed / reloaded): re-apply current persona + mood on next ready
  const latest = useRef({ persona, mood });
  latest.current = { persona, mood };
  const onReset = useCallback(() => {
    hasInit.current = false;
    queue.current = [
      `window.setOrbPersona(${latest.current.persona})`,
      `window.setOrbState('${MOOD_TO_ORB_STATE[latest.current.mood]}')`,
    ];
    webRef.current?.reload();
  }, []);

  return (
    <View pointerEvents="none" style={styles.container}>
      <WebView
        ref={webRef}
        source={SOURCE}
        originWhitelist={ORIGIN_WHITELIST}
        onMessage={onMessage}
        onLoadEnd={onLoadEnd}
        onContentProcessDidTerminate={onReset}
        onRenderProcessGone={onReset}
        javaScriptEnabled
        domStorageEnabled
        androidLayerType="hardware"
        style={styles.webview}
        containerStyle={styles.webviewContainer}
        scrollEnabled={false}
        bounces={false}
        overScrollMode="never"
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}
        setBuiltInZoomControls={false}
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction
      />
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    width: LAYOUT.orb.nativeSize,
    height: LAYOUT.orb.nativeSize,
    backgroundColor: 'transparent',
  },
  webview: {
    flex: 1,
    backgroundColor: 'transparent',
    // iOS transparency workaround: opacity just below 1 keeps the WebView background see-through
    opacity: 0.99,
  },
  webviewContainer: {
    backgroundColor: 'transparent',
  },
});
