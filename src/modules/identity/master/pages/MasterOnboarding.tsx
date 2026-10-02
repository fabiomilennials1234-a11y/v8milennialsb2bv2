import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/ui/page-header";
import { PipelineTemplatesTab } from "../components/onboarding/PipelineTemplatesTab";
import { AutomationTemplatesTab } from "../components/onboarding/AutomationTemplatesTab";
import { OnboardingPreviewTab } from "../components/onboarding/OnboardingPreviewTab";

export default function MasterOnboarding() {
  return (
    <Tabs defaultValue="pipelines" className="space-y-5">
      <PageHeader
        title="Onboarding Templates"
        subtitle="Gerencie templates de pipeline e automação para o onboarding de novas organizações"
        tabs={
          <TabsList variant="pill">
            <TabsTrigger value="pipelines">Pipeline Templates</TabsTrigger>
            <TabsTrigger value="automations">Automação Templates</TabsTrigger>
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
