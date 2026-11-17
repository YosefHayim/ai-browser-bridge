import { FanOutProvidersDemo } from "@site/landing/feature-demos/fan-out-providers.tsx";
import { FileMentionsDemo } from "@site/landing/feature-demos/file-mentions.tsx";
import { FlowVideoDemo } from "@site/landing/feature-demos/flow-video.tsx";
import { OrganizeConversationsDemo } from "@site/landing/feature-demos/organize-conversations.tsx";
import { PermissionCheckpointsDemo } from "@site/landing/feature-demos/permission-checkpoints.tsx";
import { SearchConversationsDemo } from "@site/landing/feature-demos/search-conversations.tsx";

export function FeatureDemosSection() {
  return (
    <section class="sec wrap" id="features">
      <div class="sec-head">
        <h2 class="h2">What the bridge does, running</h2>
        <p class="lede">Short loops of real commands. Each one plays while it is on screen.</p>
      </div>
      <div class="fd-grid">
        <OrganizeConversationsDemo />
        <SearchConversationsDemo />
        <FanOutProvidersDemo />
        <PermissionCheckpointsDemo />
        <FileMentionsDemo />
        <FlowVideoDemo />
      </div>
    </section>
  );
}
