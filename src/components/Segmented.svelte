<script lang="ts">
  // Stub. Phase 5 implements this: a segmented control (§8 "Segmented control",
  // §9 Phase 5 task 1). Props: options { value, label, sublabel? }[], bindable value.
  interface Option {
    value: string;
    label: string;
    sublabel?: string;
  }

  interface Props {
    options: Option[];
    value?: string;
  }

  let { options, value = $bindable() }: Props = $props();
</script>
