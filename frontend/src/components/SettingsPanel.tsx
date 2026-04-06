import { Settings, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { useSettingsStore } from '@/stores/settingsStore';

export function SettingsPanel() {
  const { settings, updateSettings, resetSettings } = useSettingsStore();

  return (
    <div className="space-y-4">
      {/* API Settings */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Settings className="h-4 w-4" />
            Transkriptions-API
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>API Basis-URL</Label>
            <Input
              placeholder="/v1"
              value={settings.apiBaseUrl}
              onChange={(e) => updateSettings({ apiBaseUrl: e.target.value })}
            />
          </div>

          <div className="space-y-2">
            <Label>Streaming-Modus</Label>
            <div className="flex gap-2">
              <Button
                variant={settings.streamingMode === 'http' ? 'default' : 'outline'}
                size="sm"
                onClick={() => updateSettings({ streamingMode: 'http' })}
              >
                HTTP
              </Button>
              <Button
                variant={settings.streamingMode === 'websocket' ? 'default' : 'outline'}
                size="sm"
                onClick={() => updateSettings({ streamingMode: 'websocket' })}
              >
                WebSocket
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Chunk-Dauer (Sekunden)</Label>
            <Input
              type="number"
              min={1}
              max={30}
              value={settings.chunkDuration}
              onChange={(e) =>
                updateSettings({ chunkDuration: parseInt(e.target.value) || 5 })
              }
            />
          </div>
        </CardContent>
      </Card>

      {/* Diarization */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Sprechererkennung</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <Label>Diarisierung aktivieren</Label>
            <Switch
              checked={settings.diarize}
              onCheckedChange={(checked) => updateSettings({ diarize: checked })}
            />
          </div>

          {settings.diarize && (
            <>
              <div className="space-y-2">
                <Label>Anzahl Sprecher</Label>
                <Input
                  type="number"
                  min={1}
                  max={10}
                  value={settings.numSpeakers}
                  onChange={(e) =>
                    updateSettings({ numSpeakers: parseInt(e.target.value) || 2 })
                  }
                />
              </div>

              <div className="space-y-2">
                <Label>Sprechernamen (kommagetrennt)</Label>
                <Input
                  placeholder="Arzt, Patient"
                  value={settings.speakerNames}
                  onChange={(e) => updateSettings({ speakerNames: e.target.value })}
                />
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* OpenAI Settings */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">OpenAI / KI-Assistent</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>API-URL</Label>
            <Input
              placeholder="https://api.openai.com/v1"
              value={settings.openaiApiUrl}
              onChange={(e) => updateSettings({ openaiApiUrl: e.target.value })}
            />
          </div>

          <div className="space-y-2">
            <Label>API-Key</Label>
            <Input
              type="password"
              placeholder="sk-..."
              value={settings.openaiApiKey}
              onChange={(e) => updateSettings({ openaiApiKey: e.target.value })}
            />
          </div>

          <div className="space-y-2">
            <Label>Modell</Label>
            <Input
              placeholder="gpt-4"
              value={settings.openaiModel}
              onChange={(e) => updateSettings({ openaiModel: e.target.value })}
            />
          </div>
        </CardContent>
      </Card>

      {/* Storage Settings */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Speicher</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Speichermodus</Label>
            <div className="flex gap-2">
              <Button
                variant={settings.storageMode === 'local' ? 'default' : 'outline'}
                size="sm"
                onClick={() => updateSettings({ storageMode: 'local' })}
              >
                Lokal
              </Button>
              <Button
                variant={settings.storageMode === 'rest' ? 'default' : 'outline'}
                size="sm"
                onClick={() => updateSettings({ storageMode: 'rest' })}
              >
                REST API
              </Button>
            </div>
          </div>

          {settings.storageMode === 'rest' && (
            <div className="space-y-2">
              <Label>REST API URL</Label>
              <Input
                placeholder="https://api.example.com/storage"
                value={settings.restApiUrl}
                onChange={(e) => updateSettings({ restApiUrl: e.target.value })}
              />
            </div>
          )}
        </CardContent>
      </Card>

      <Separator />

      {/* Reset */}
      <Button
        variant="outline"
        onClick={resetSettings}
        className="gap-2"
      >
        <RotateCcw className="h-4 w-4" />
        Einstellungen zurücksetzen
      </Button>
    </div>
  );
}
