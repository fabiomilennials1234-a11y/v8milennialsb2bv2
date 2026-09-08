import { GuidedLeadValuePicker } from './GuidedLeadValuePicker';

export function GuidedUtmPicker(props: {
  id: string; actorId: string; organizationId: string; field: string; value: string; onChange: (value: string) => void;
}) {
  return <GuidedLeadValuePicker {...props} errorMessage="Não foi possível carregar sugestões UTM." />;
}
