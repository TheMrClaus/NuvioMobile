import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  StatusBar,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../contexts/ThemeContext';
import ScreenHeader from '../components/common/ScreenHeader';
import {
  embyService,
  EMBY_SERVER_URL_KEY,
  EMBY_API_KEY_KEY,
  EMBY_USER_ID_KEY,
} from '../services/emby/embyService';
import { mmkvStorage } from '../services/mmkvStorage';

const EmbySettingsScreen: React.FC = () => {
  const navigation = useNavigation();
  const { currentTheme } = useTheme();
  const insets = useSafeAreaInsets();

  const [serverUrl, setServerUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [serverName, setServerName] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [statusType, setStatusType] = useState<'success' | 'error' | 'idle'>('idle');

  const loadSavedCredentials = useCallback(async () => {
    const [savedUrl, savedKey, savedUserId] = await Promise.all([
      mmkvStorage.getItem(EMBY_SERVER_URL_KEY),
      mmkvStorage.getItem(EMBY_API_KEY_KEY),
      mmkvStorage.getItem(EMBY_USER_ID_KEY),
    ]);
    if (savedUrl) setServerUrl(savedUrl);
    if (savedKey) setApiKey(savedKey);
    setIsConnected(!!(savedUrl && savedKey && savedUserId));
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadSavedCredentials();
    }, [loadSavedCredentials])
  );

  const handleTestAndSave = async () => {
    const trimmedUrl = serverUrl.trim();
    const trimmedKey = apiKey.trim();

    if (!trimmedUrl) {
      setStatusMessage('Please enter the server URL.');
      setStatusType('error');
      return;
    }
    if (!trimmedKey) {
      setStatusMessage('Please enter an API key.');
      setStatusType('error');
      return;
    }

    setIsTesting(true);
    setStatusMessage('');
    setStatusType('idle');

    const result = await embyService.testConnection(trimmedUrl, trimmedKey);

    if (result.ok) {
      await embyService.saveCredentials(trimmedUrl, trimmedKey, result.userId);
      setIsConnected(true);
      setServerName(result.serverName);
      setStatusMessage(`Connected to "${result.serverName}"`);
      setStatusType('success');
    } else {
      setStatusMessage('Connection failed. Check the URL and API key and try again.');
      setStatusType('error');
    }

    setIsTesting(false);
  };

  const handleDisconnect = async () => {
    await embyService.clearCredentials();
    setIsConnected(false);
    setServerName('');
    setServerUrl('');
    setApiKey('');
    setStatusMessage('Disconnected from Emby.');
    setStatusType('idle');
  };

  const c = currentTheme.colors;

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: c.darkBackground }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <StatusBar barStyle="light-content" />
      <ScreenHeader
        title="Emby Server"
        showBackButton
        onBackPress={() => navigation.goBack()}
      />

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 32 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Status banner */}
        {isConnected && (
          <View style={[styles.connectedBanner, { backgroundColor: c.primary + '22', borderColor: c.primary }]}>
            <Feather name="check-circle" size={16} color={c.primary} />
            <Text style={[styles.connectedText, { color: c.primary }]}>
              {serverName ? `Connected to "${serverName}"` : 'Connected'}
            </Text>
          </View>
        )}

        {/* Description */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: c.mediumEmphasis }]}>SERVER CONFIGURATION</Text>
          <View style={[styles.card, { backgroundColor: c.elevation1, borderColor: c.elevation2 }]}>
            <Text style={[styles.description, { color: c.text }]}>
              Connect Nuvio to your Emby server so it can play your personal media library
              and report playback progress back to the server.
            </Text>
          </View>
        </View>

        {/* Input fields */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: c.mediumEmphasis }]}>CREDENTIALS</Text>
          <View style={[styles.card, { backgroundColor: c.elevation1, borderColor: c.elevation2 }]}>
            {/* Server URL */}
            <View style={styles.inputGroup}>
              <Text style={[styles.inputLabel, { color: c.text }]}>Server URL</Text>
              <TextInput
                style={[styles.textInput, { color: c.text, borderColor: c.elevation2, backgroundColor: c.elevation2 }]}
                value={serverUrl}
                onChangeText={setServerUrl}
                placeholder="http://192.168.1.100:8096"
                placeholderTextColor={c.lowEmphasis || c.mediumEmphasis}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
              />
              <Text style={[styles.inputHint, { color: c.mediumEmphasis }]}>
                Include protocol and port, e.g. http://192.168.1.100:8096
              </Text>
            </View>

            <View style={[styles.divider, { backgroundColor: c.elevation2 }]} />

            {/* API Key */}
            <View style={styles.inputGroup}>
              <Text style={[styles.inputLabel, { color: c.text }]}>API Key</Text>
              <View style={styles.inputRow}>
                <TextInput
                  style={[styles.textInput, styles.inputRowField, { color: c.text, borderColor: c.elevation2, backgroundColor: c.elevation2 }]}
                  value={apiKey}
                  onChangeText={setApiKey}
                  placeholder="Paste your Emby API key here"
                  placeholderTextColor={c.lowEmphasis || c.mediumEmphasis}
                  autoCapitalize="none"
                  autoCorrect={false}
                  secureTextEntry={!showApiKey}
                />
                <TouchableOpacity onPress={() => setShowApiKey(v => !v)} style={styles.eyeButton}>
                  <Feather name={showApiKey ? 'eye-off' : 'eye'} size={18} color={c.mediumEmphasis} />
                </TouchableOpacity>
              </View>
              <Text style={[styles.inputHint, { color: c.mediumEmphasis }]}>
                Dashboard → Admin → API Keys → New API Key
              </Text>
            </View>
          </View>
        </View>

        {/* Status message */}
        {!!statusMessage && (
          <View style={styles.section}>
            <Text
              style={[
                styles.statusText,
                { color: statusType === 'success' ? c.primary : statusType === 'error' ? '#FF6B6B' : c.mediumEmphasis },
              ]}
            >
              {statusMessage}
            </Text>
          </View>
        )}

        {/* Action buttons */}
        <View style={styles.section}>
          <TouchableOpacity
            style={[styles.primaryButton, { backgroundColor: c.primary }, isTesting && styles.disabledButton]}
            onPress={handleTestAndSave}
            disabled={isTesting}
            activeOpacity={0.8}
          >
            {isTesting ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.primaryButtonText}>
                {isConnected ? 'Re-test & Save' : 'Test Connection & Save'}
              </Text>
            )}
          </TouchableOpacity>

          {isConnected && (
            <TouchableOpacity
              style={[styles.dangerButton, { borderColor: '#FF6B6B' }]}
              onPress={handleDisconnect}
              activeOpacity={0.8}
            >
              <Text style={[styles.dangerButtonText, { color: '#FF6B6B' }]}>Disconnect</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Help section */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: c.mediumEmphasis }]}>HOW IT WORKS</Text>
          <View style={[styles.card, { backgroundColor: c.elevation1, borderColor: c.elevation2 }]}>
            <HelpRow icon="search" text="Nuvio searches your Emby library using IMDb/TMDB IDs when you open a streams list." c={c} />
            <View style={[styles.divider, { backgroundColor: c.elevation2 }]} />
            <HelpRow icon="play" text='Emby streams appear at the top of the list labelled "Emby Server".' c={c} />
            <View style={[styles.divider, { backgroundColor: c.elevation2 }]} />
            <HelpRow icon="activity" text="Playback progress is reported back to your server in real time." c={c} isLast />
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const HelpRow: React.FC<{
  icon: string;
  text: string;
  c: any;
  isLast?: boolean;
}> = ({ icon, text, c }) => (
  <View style={styles.helpRow}>
    <Feather name={icon as any} size={16} color={c.primary} style={styles.helpIcon} />
    <Text style={[styles.helpText, { color: c.text }]}>{text}</Text>
  </View>
);

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollView: { flex: 1 },
  scrollContent: { paddingTop: 16, paddingHorizontal: 16 },
  connectedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 8,
  },
  connectedText: { fontSize: 14, fontWeight: '600' },
  section: { marginBottom: 20 },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.8,
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  description: { fontSize: 14, lineHeight: 20 },
  inputGroup: { paddingVertical: 8 },
  inputLabel: { fontSize: 14, fontWeight: '600', marginBottom: 8 },
  textInput: {
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 12 : 10,
    fontSize: 14,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  inputRowField: {
    flex: 1,
  },
  eyeButton: {
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  inputHint: { fontSize: 11, marginTop: 4 },
  divider: { height: 1, marginVertical: 4 },
  statusText: { fontSize: 14, textAlign: 'center' },
  primaryButton: {
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 12,
  },
  primaryButtonText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  disabledButton: { opacity: 0.6 },
  dangerButton: {
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
  },
  dangerButtonText: { fontSize: 15, fontWeight: '600' },
  helpRow: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 8 },
  helpIcon: { marginRight: 10, marginTop: 1 },
  helpText: { flex: 1, fontSize: 13, lineHeight: 18 },
});

export default EmbySettingsScreen;
