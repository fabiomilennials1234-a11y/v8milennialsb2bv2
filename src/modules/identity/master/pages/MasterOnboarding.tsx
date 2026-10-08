import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MasterPageHeader } from "../components/MasterPageHeader";
import { PipelineTemplatesTab } from "../components/onboarding/PipelineTemplatesTab";
import { AutomationTemplatesTab } from "../components/onboarding/AutomationTemplatesTab";
import { OnboardingPreviewTab } from "../components/onboarding/OnboardingPreviewTab";

export default function MasterOnboarding() {
  return (
    <Tabs defaultValue="pipelines" className="space-y-5">
      <MasterPageHeader
        title="Templates de onboarding"
        subtitle="Gerencie templates de pipeline e automação para o onboarding de novas organizações"
        tabs={
          <TabsList aria-label="Tipos de template" className="max-w-full overflow-x-auto scrollbar-hide">
            <TabsTrigger value="pipelines">Templates de pipeline</TabsTrigger>
            <TabsTrigger value="automations">Templates de automação</TabsTrigger>
            <TabsTrigger value="preview">Preview</TabsTrigger>
          </TabsList>
        }
      />
      <TabsContent value="pipelines" className="mt-0"><PipelineTemplatesTab /></TabsContent>
      <TabsContent value="automations" className="mt-0"><AutomationTemplatesTab /></TabsContent>
      <TabsContent value="preview" className="mt-0"><OnboardingPreviewTab /></TabsContent>
    </Tabs>
  );
}
