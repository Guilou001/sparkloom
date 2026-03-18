import { VideoPage } from "./pages/VideoPage";
import { NotFound } from "./pages/NotFound";

function getRoute(): { page: "video"; token: string } | { page: "not-found" } {
  const path = window.location.pathname;

  // /v/:share_token or /share/:share_token
  const videoMatch = path.match(/^\/(v|share)\/([a-f0-9]+)\/?$/);
  if (videoMatch) {
    return { page: "video", token: videoMatch[2] };
  }

  return { page: "not-found" };
}

export default function App() {
  const route = getRoute();

  if (route.page === "video") {
    return <VideoPage shareToken={route.token} />;
  }

  return <NotFound />;
}
