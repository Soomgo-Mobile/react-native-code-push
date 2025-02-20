/**
 * Sample React Native App
 * https://github.com/facebook/react-native
 *
 * @format
 */

import React from "react";
import type {PropsWithChildren} from "react";
import {
  Button,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  useColorScheme,
  View,
} from "react-native";
import CodePush, {
  ReleaseHistoryInterface,
  UpdateCheckRequest,
} from "@bravemobile/react-native-code-push";
import axios from "axios";
import {getPlatform, trackError} from "./utils";

import {Colors, Header} from "react-native/Libraries/NewAppScreen";

type SectionProps = PropsWithChildren<{
  title: string;
}>;

function Section({children, title}: SectionProps): React.JSX.Element {
  const isDarkMode = useColorScheme() === "dark";
  return (
    <View style={styles.sectionContainer}>
      <Text
        style={[
          styles.sectionTitle,
          {
            color: isDarkMode ? Colors.white : Colors.black,
          },
        ]}>
        {title}
      </Text>
      <Text
        style={[
          styles.sectionDescription,
          {
            color: isDarkMode ? Colors.light : Colors.dark,
          },
        ]}>
        {children}
      </Text>
    </View>
  );
}

function App(): React.JSX.Element {
  const isDarkMode = useColorScheme() === "dark";

  const backgroundStyle = {
    backgroundColor: isDarkMode ? Colors.darker : Colors.lighter,
  };

  return (
    <SafeAreaView style={backgroundStyle}>
      <StatusBar
        barStyle={isDarkMode ? "light-content" : "dark-content"}
        backgroundColor={backgroundStyle.backgroundColor}
      />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        style={backgroundStyle}>
        <Header />
        <View
          style={{
            backgroundColor: isDarkMode ? Colors.black : Colors.white,
          }}>
          <Section title="Step One">
            <Button
              title={"Check for updates"}
              onPress={async () => {
                const result = await CodePush.sync();
                const status = Object.entries(CodePush.SyncStatus).find(
                  ([key, value]) => value === result,
                );
                console.log("SyncStatus", status?.at(0));
              }}
            />
          </Section>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  sectionContainer: {
    marginTop: 32,
    paddingHorizontal: 24,
  },
  sectionTitle: {
    fontSize: 24,
    fontWeight: "600",
  },
  sectionDescription: {
    marginTop: 8,
    fontSize: 18,
    fontWeight: "400",
  },
  highlight: {
    fontWeight: "700",
  },
});

const CDN_HOST = "https://your.cdn.provider.com";

async function releaseHistoryFetcher(
  updateRequest: UpdateCheckRequest,
): Promise<ReleaseHistoryInterface> {
  const identifier = "staging";
  const jsonFileName = `${updateRequest.app_version}.json`;
  try {
    // ❗️ URL of release history JSON file uploaded using `npx code-push` command. (code-push.config.ts)
    const releaseHistoryUrl = `${CDN_HOST}/histories/${getPlatform()}/${identifier}/${jsonFileName}`;

    const {data: releaseHistory} = await axios.get<ReleaseHistoryInterface>(
      releaseHistoryUrl,
      {
        headers: {
          Accept: "application/json",
          "Cache-Control": "no-cache",
        },
      },
    );

    console.log("releaseHistory response", releaseHistory);
    return releaseHistory;
  } catch (error: unknown) {
    trackError(error);
    throw error;
  }
}

export default CodePush({
  checkFrequency: CodePush.CheckFrequency.MANUAL,
  releaseHistoryFetcher: releaseHistoryFetcher,
})(App);
