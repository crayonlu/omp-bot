import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs";
import { useWebSocket } from "./hooks/useWebSocket";
import Overview from "./panels/Overview";
import Channels from "./panels/Channels";
import Persona from "./panels/Persona";
import Activity from "./panels/Activity";
import Settings from "./panels/Settings";

const wsUrl = `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws`;

function App() {
  const { lastMessage } = useWebSocket(wsUrl);

  return (
    <div className="mx-auto max-w-5xl p-6">
      <h1 className="mb-6 text-2xl font-bold">Oh My Pi 控制台</h1>
      <Tabs defaultValue="overview">
        <TabsList className="mb-6">
          <TabsTrigger value="overview">总览</TabsTrigger>
          <TabsTrigger value="channels">频道</TabsTrigger>
          <TabsTrigger value="persona">人格</TabsTrigger>
          <TabsTrigger value="activity">活动</TabsTrigger>
          <TabsTrigger value="settings">设置</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <Overview wsMessage={lastMessage} />
        </TabsContent>
        <TabsContent value="channels">
          <Channels />
        </TabsContent>
        <TabsContent value="persona">
          <Persona />
        </TabsContent>
        <TabsContent value="activity">
          <Activity wsMessage={lastMessage} />
        </TabsContent>
        <TabsContent value="settings">
          <Settings />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default App;