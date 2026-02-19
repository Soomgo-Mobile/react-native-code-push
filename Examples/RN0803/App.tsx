import React, { useCallback, useState } from 'react';
import {
  Button,
  Platform,
  ScrollView,
  StatusBar,
  Text,
  TextInput,
  View,
} from 'react-native';
import CodePush, {
  ReleaseHistoryInterface,
  UpdateCheckRequest,
} from '@bravemobile/react-native-code-push';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

// Set this to true before run `npx code-push release` to release a new bundle
const IS_RELEASING_BUNDLE = false;

const REACT_NATIVE_VERSION = (() => {
  const { major, minor, patch, prerelease } = Platform.constants.reactNativeVersion;
  return `${major}.${minor}.${patch}` + (prerelease ? `-${prerelease}` : '');
})();

function App() {
  const { top } = useSafeAreaInsets();
  const [syncResult, setSyncResult] = useState('');
  const [progress, setProgress] = useState(0);
  const [runningMetadata, setRunningMetadata] = useState('');
  const [pendingMetadata, setPendingMetadata] = useState('');
  const [latestMetadata, setLatestMetadata] = useState('');

  const handleSync = useCallback(() => {
    CodePush.sync(
      {},
      status => {
        setSyncResult(findKeyByValue(CodePush.SyncStatus, status) ?? '');
      },
      ({ receivedBytes, totalBytes }) => {
        setProgress(Math.round((receivedBytes / totalBytes) * 100));
      },
      mismatch => {
        console.log('CodePush mismatch', JSON.stringify(mismatch, null, 2));
      },
    ).catch(error => {
      console.error(error);
      console.log('Sync failed', error.message ?? 'Unknown error');
    });
  }, []);

  const handleMetadata = useCallback(async () => {
    const [running, pending, latest] = await Promise.all([
      CodePush.getUpdateMetadata(CodePush.UpdateState.RUNNING),
      CodePush.getUpdateMetadata(CodePush.UpdateState.PENDING),
      CodePush.getUpdateMetadata(CodePush.UpdateState.LATEST),
    ]);
    setRunningMetadata(JSON.stringify(running ?? null, null, 2));
    setPendingMetadata(JSON.stringify(pending ?? null, null, 2));
    setLatestMetadata(JSON.stringify(latest ?? null, null, 2));
  }, []);

  return (
    <View style={{ flex: 1, paddingTop: top, backgroundColor: 'white' }}>
      <Text style={{ fontSize: 20, fontWeight: '600' }}>
        {`React Native ${REACT_NATIVE_VERSION}`}
      </Text>
      {IS_RELEASING_BUNDLE && <Text style={{ fontSize: 20, fontWeight: '600' }}>
        {'UPDATED!'}
      </Text>}

      <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
        <View style={{ gap: 8 }}>
          <Button title="Check for updates" onPress={handleSync} />
          <Text>{`Result: ${syncResult}`}</Text>
          <Text>{`Progress: ${progress > 0 ? `${progress}%` : ''}`}</Text>
        </View>

        <View style={{ gap: 8 }}>
          <Button
            title="Clear updates"
            onPress={() => {
              CodePush.clearUpdates();
              setSyncResult('');
              setProgress(0);
            }}
          />
          <Button title="Restart app" onPress={() => CodePush.restartApp()} />
          <Button title="Get update metadata" onPress={handleMetadata} />
          <Text>{runningMetadata === '' ? 'METADATA_IDLE' : runningMetadata === 'null' ? 'METADATA_NULL' : `METADATA_V${JSON.parse(runningMetadata).label}`}</Text>
          <MetadataBlock label="Running" value={runningMetadata} />
          <MetadataBlock label="Pending" value={pendingMetadata} />
          <MetadataBlock label="Latest" value={latestMetadata} />
        </View>
      </ScrollView>
    </View>
  );
}

function MetadataBlock({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  return (
    <View style={{ gap: 4 }}>
      <Text style={{ fontWeight: '600' }}>{label}</Text>
      <TextInput
        value={String(value)}
        multiline
        style={{ borderWidth: 1, borderRadius: 4, padding: 8, minHeight: 60, color: 'black' }}
      />
    </View>
  );
}

const CODEPUSH_HOST = 'PLACEHOLDER';
const IDENTIFIER = 'RN0803';

async function releaseHistoryFetcher(
  updateRequest: UpdateCheckRequest,
): Promise<ReleaseHistoryInterface> {
  const jsonFileName = `${updateRequest.app_version}.json`;
  const releaseHistoryUrl = `${CODEPUSH_HOST}/histories/${getPlatform()}/${IDENTIFIER}/${jsonFileName}`;

  try {
    const response = await fetch(releaseHistoryUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'Cache-Control': 'no-cache',
      },
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch release history: ${response.status} ${response.statusText}`);
    }
    return (await response.json()) as ReleaseHistoryInterface;
  } catch (error) {
    console.error(error);
    throw error;
  }
}

function WithSafeAreaProvider() {
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" />
      <App />
    </SafeAreaProvider>
  );
}

export default CodePush({
  checkFrequency: CodePush.CheckFrequency.MANUAL,
  releaseHistoryFetcher,
  onUpdateSuccess: label => {
    console.log('Update success', label);
  },
  onUpdateRollback: label => {
    console.log('Update rolled back', label);
  },
  onSyncError: (label, error) => {
    console.error(error);
    console.log('Sync error', label);
  },
  onDownloadStart: label => {
    console.log('Download start', label);
  },
  onDownloadSuccess: label => {
    console.log('Download success', label);
  },
})(WithSafeAreaProvider);

function getPlatform() {
  switch (Platform.OS) {
    case 'ios':
      return 'ios';
    case 'android':
      return 'android';
    default:
      throw new Error('Unsupported platform');
  }
}

function findKeyByValue(
  object: Record<string, unknown>,
  value: unknown,
) {
  return Object.keys(object).find(key => object[key] === value);
}
