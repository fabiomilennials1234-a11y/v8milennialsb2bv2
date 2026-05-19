import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PipelineTemplatesTab } from "@/components/master/onboarding/PipelineTemplatesTab";
import { AutomationTemplatesTab } from "@/components/master/onboarding/AutomationTemplatesTab";
import { OnboardingPreviewTab } from "@/components/master/onboarding/OnboardingPreviewTab";

export default function MasterOnboarding() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Onboarding Templates</h1>
        <p className="text-sm text-muted-foreground">
          Gerencie templates de pipeline e automação para o onboarding de novas organizações
        </p>
      </div>
      <Tabs defaultValue="pipelines">
        <TabsList>
          <TabsTrigger value="pipelines">Pipeline Templates</TabsTrigger>
          <TabsTrigger value="automations">Automação Templates</TabsTrigger>
          <TabsTrigger value="preview">Preview</TabsTrigger>
        </TabsList>
        <TabsContent value="pipelines"><PipelineTemplatesTab /></TabsContent>
        <TabsContent value="automations"><AutomationTemplatesTab /></TabsContent>
        <TabsContent value="preview"><OnboardingPreviewTab /></TabsContent>
      </Tabs>
    </div>
  );
}
