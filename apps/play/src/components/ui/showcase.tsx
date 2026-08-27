import React, { useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Checkbox,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Field,
  Heading,
  HStack,
  IconButton,
  Input,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  Skeleton,
  Spacer,
  Spinner,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Text,
  Textarea,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  VStack,
} from "./index";

/**
 * A self-contained gallery that exercises every component in the v0.1 set.
 * Swap `render(<App />)` for `render(<Showcase />)` in app.tsx to view it.
 */
export function Showcase() {
  const [checked, setChecked] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [name, setName] = useState("");
  const [difficulty, setDifficulty] = useState("hard");

  return (
    <div
      style={{
        flexGrow: 1,
        flexBasis: 0,
        minHeight: 0,
        backgroundColor: "#0c0e12",
        padding: 24,
        overflow: "scroll",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
      }}
    >
      <VStack gap="xl" align="center" style={{ maxWidth: 720, width: "100%" }}>
        <VStack gap="sm" align="center">
          <Heading level={1}>GPUIX UI</Heading>
          <Text muted>Source-first component gallery for Roxysu Play</Text>
          <Badge variant="success">Ready</Badge>
        </VStack>

        <Card style={{ width: "100%" }}>
          <CardHeader>
            <CardTitle>Roxysu Analyzer</CardTitle>
            <CardDescription>Pick a beatmap and tune the playfield.</CardDescription>
          </CardHeader>

          <CardContent>
            <VStack gap="md">
              <Field label="Beatmap name">
                <Input
                  placeholder="Search beatmaps..."
                  value={name}
                  onValueChange={setName}
                />
              </Field>

              <Field label="Difficulty">
                <Select value={difficulty} onValueChange={setDifficulty}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select difficulty" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="easy">Easy</SelectItem>
                    <SelectItem value="hard">Hard</SelectItem>
                    <SelectItem value="expert">Expert</SelectItem>
                  </SelectContent>
                </Select>
              </Field>

              <HStack gap="md">
                <Checkbox checked={checked} onCheckedChange={setChecked} />
                <Label>Show receptor glow</Label>
              </HStack>

              <HStack gap="md">
                <Switch checked={enabled} onCheckedChange={setEnabled} />
                <Label>Live recompile</Label>
              </HStack>

              <Textarea placeholder="Notes for this chart..." />

              <Separator />

              <HStack gap="sm">
                <Button>Analyze</Button>
                <Button variant="outline">Export</Button>
                <Button variant="ghost">Cancel</Button>
                <Button variant="destructive">Delete</Button>
                <Button variant="link">Docs</Button>
                <IconButton>
                  <Text>↻</Text>
                </IconButton>
                <Button loading>Loading</Button>
              </HStack>
            </VStack>
          </CardContent>

          <CardFooter>
            <Spacer />
            <Text muted size="sm">v0.1 MVP</Text>
          </CardFooter>
        </Card>

        <Tabs defaultValue="overlays" style={{ width: "100%" }}>
          <TabsList>
            <TabsTrigger value="overlays">Overlays</TabsTrigger>
            <TabsTrigger value="loading">Loading</TabsTrigger>
          </TabsList>

          <TabsContent value="overlays">
            <HStack gap="md">
              <Tooltip>
                <TooltipTrigger>
                  <Button variant="secondary">Hover me</Button>
                </TooltipTrigger>
                <TooltipContent>Tooltip content</TooltipContent>
              </Tooltip>

              <Popover>
                <PopoverTrigger>
                  <Button variant="secondary">Open popover</Button>
                </PopoverTrigger>
                <PopoverContent>
                  <VStack gap="sm">
                    <Text weight="semibold">Popover</Text>
                    <Text muted size="sm">Anchored to its trigger.</Text>
                    <Button size="sm">Action</Button>
                  </VStack>
                </PopoverContent>
              </Popover>

              <Dialog>
                <DialogTrigger>
                  <Button variant="secondary">Open dialog</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Confirm</DialogTitle>
                  </DialogHeader>
                  <DialogFooter>
                    <Button variant="outline">Close</Button>
                    <Button>Confirm</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </HStack>
          </TabsContent>

          <TabsContent value="loading">
            <HStack gap="lg" align="center">
              <Spinner />
              <Skeleton width={160} height={14} />
              <Skeleton width={120} height={14} />
            </HStack>
          </TabsContent>
        </Tabs>
      </VStack>
    </div>
  );
}
